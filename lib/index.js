/**
 * dsh-git-auth — host tool bundle for glab / gh credential and SSH key
 * management.
 *
 * Tool plugin (Cordis): exports `name`, `inject`, `Config`, `apply`. Registers
 * three model-facing tools and one user-editable settings namespace:
 *   - auth_status   read-only status of gh, glab, and the SSH agent/keys
 *   - client_auth   non-interactive gh/glab login (token via stdin) or logout
 *   - ssh_key       generate / list / show SSH keys (ed25519)
 *
 * All commands run through the host `ctx.shell` seam with the calling
 * session's sandbox policy and cancellation signal.
 * @module dsh-git-auth
 */
import z from "@deepseek-ai/schemastery";
import { dirname } from "node:path";
import { approveEscalation, sandboxDenialMarker } from "@deepseek-ai/dsh-sandbox";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { assertSafeSshPath, composeAuthCommand, mergeOptions, normalizeHost, resolveSshPath, resolveToken, shellArg } from "./compose.js";

const name = "git-auth";
const inject = ["tools", "shell", "sandboxPolicy"];

/** Settings namespace owned by this plugin (rendered under Settings > Plugins). */
const SETTINGS_NAMESPACE = "git-auth";

/**
 * User-editable settings schema. Defaults live on the schema; the entry
 * config seeds the `base` layer; the user document (settings.yaml) overrides
 * both.
 */
const AuthSettingsSchema = z.object({
	ghHost: z.string().default("github.com").description("Default GitHub host for gh login."),
	glabHost: z.string().default("gitlab.com").description("Default GitLab host for glab login."),
	commandTimeoutMs: z.number().step(1).min(1).default(60000).description("Per sub-command timeout (ms)."),
	sshPath: z.string().default("").description("Default SSH key path (empty -> ~/.ssh/id_ed25519)."),
	sshComment: z.string().default("").description("Default comment attached to generated keys."),
	sshAddAgent: z.boolean().default(false).description("Load generated keys into ssh-agent by default."),
});

/** Entry configuration (validated by the Loader; seeds the settings base layer). */
const Config = AuthSettingsSchema;

/** Resolve the effective options: schema defaults < entry config < user settings. */
function currentOptions(ctx, config) {
	const value = ctx.get("settings")?.get(settingsNamespace(SETTINGS_NAMESPACE));
	return mergeOptions(config, value ?? {});
}

/** Run one command through the host shell seam and return combined output text. */
async function run(ctx, command, { stdin = "", signal, timeoutMs, sandboxPolicy, check = false }) {
	const result = await ctx.shell.run(ctx.shell.resolve({
		command,
		signal,
		timeoutMs,
		...stdin ? { stdin } : {},
		...sandboxPolicy ? { sandboxPolicy } : {},
	}));
	if (result.aborted) throw new Error("tool call aborted");
	const err = result.stderr?.text ?? "";
	const out = result.stdout?.text ?? "";
	const body = [out, err].filter(Boolean).join("\n");
	const markers = [];
	if (result.sandbox?.denied) markers.push(sandboxDenialMarker(result.sandbox.mode));
	if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`);
	if (result.signal !== null) markers.push(`[killed by signal: ${result.signal}]`);
	else if (result.exitCode !== 0) markers.push(`[exit code: ${result.exitCode}]`);
	const text = [body || "(no output)", ...markers].join("\n");
	if (check && (result.timedOut || result.signal !== null || result.exitCode !== 0 || result.sandbox?.denied)) throw new Error(text);
	return text;
}

/** Resolve the calling session's immutable sandbox policy. */
function currentSandboxPolicy(ctx, exec) {
	return ctx.sandboxPolicy.resolve(exec.agent === undefined ? {} : { session: exec.agent.session });
}

/** Ask before widening one credential mutation beyond the session workspace. */
async function authorizeMutation(ctx, exec, toolName, justification) {
	const policy = currentSandboxPolicy(ctx, exec);
	if (policy.mode === "danger-full-access") return policy;
	const mode = await approveEscalation({
		requestedMode: "danger-full-access",
		effectiveMode: policy.mode,
		justification,
		subject: "operation",
	}, {
		approver: ctx.get("approval"),
		agent: exec.agent,
		callId: exec.callId,
		toolName,
		signal: exec.signal,
	});
	return { ...policy, mode };
}

// ── auth_status ─────────────────────────────────────────────────────────────

async function statusText(ctx, opts, exec) {
	const sandboxPolicy = currentSandboxPolicy(ctx, exec);
	const parts = [];
	parts.push("## GitHub CLI (gh)\n" + await run(ctx, "gh auth status", { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy }));
	parts.push("## GitLab CLI (glab)\n" + await run(ctx, "glab auth status", { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy }));
	parts.push(await sshStatusText(ctx, opts, exec, sandboxPolicy));
	return parts.join("\n");
}

async function sshStatusText(ctx, opts, exec, sandboxPolicy = currentSandboxPolicy(ctx, exec)) {
	const parts = [];
	parts.push("## SSH-agent keys\n" + await run(ctx, "ssh-add -l", { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy }));
	parts.push("## Public key files\n" + await run(ctx, "for f in ~/.ssh/*.pub; do [ -e \"$f\" ] && echo \"$f\"; done", { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy }));
	return parts.join("\n");
}

// ── client_auth ─────────────────────────────────────────────────────────────

async function authTool(ctx, args, exec, opts, env) {
	const client = args.client;
	const configuredHost = client === "gh" ? opts.ghHost : opts.glabHost;
	const host = normalizeHost(args.hostname ?? configuredHost);
	if (args.logout) {
		const sandboxPolicy = await authorizeMutation(ctx, exec, "client_auth", `Allow ${client} to update credentials for ${host} under HOME.`);
		const { command } = composeAuthCommand(client, host, true);
		return await run(ctx, command, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	}
	const token = resolveToken(client, env, host, configuredHost);
	if (!token) {
		throw new Error(`no token available for ${client}: set ${client === "gh" ? "GH_TOKEN/GITHUB_TOKEN" : "GITLAB_TOKEN/GLAB_TOKEN/GITLAB_ACCESS_TOKEN"}`);
	}
	const sandboxPolicy = await authorizeMutation(ctx, exec, "client_auth", `Allow ${client} to update credentials for ${host} under HOME.`);
	const { command } = composeAuthCommand(client, host, false);
	return await run(ctx, command, { stdin: token, signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
}

// ── ssh_key ─────────────────────────────────────────────────────────────────

async function sshTool(ctx, args, exec, opts, env) {
	const { action } = args;

	if (action === "list") return await sshStatusText(ctx, opts, exec);
	const path = resolveSshPath(env.HOME, args.path ?? opts.sshPath);
	assertSafeSshPath(path);
	if (action === "show") {
		return await run(ctx, `cat -- ${shellArg(`${path}.pub`)}`, {
			signal: exec.signal,
			timeoutMs: opts.commandTimeoutMs,
			sandboxPolicy: currentSandboxPolicy(ctx, exec),
			check: true,
		});
	}
	// generate (default): ssh-keygen -t ed25519, optionally ssh-add, then the
	// public key so the user can paste it into GitLab/GitHub.
	const sandboxPolicy = await authorizeMutation(ctx, exec, "ssh_key", "Allow ssh_key to create or load an SSH key under HOME/.ssh.");
	let gen = `ssh-keygen -t ed25519 -N '' -f ${shellArg(path)}`;
	const comment = args.comment ?? opts.sshComment;
	if (comment) gen += ` -C ${shellArg(comment)}`;
	let out = await run(ctx, `install -d -m 700 -- ${shellArg(dirname(path))}`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	assertSafeSshPath(path);
	out += "\n" + await run(ctx, gen, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	const addAgent = args.add_agent ?? opts.sshAddAgent;
	if (addAgent) out += "\n" + await run(ctx, `ssh-add ${shellArg(path)}`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	out += "\n## Public key\n" + await run(ctx, `cat -- ${shellArg(`${path}.pub`)}`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	return out;
}

/**
 * @param ctx - the scoped Cordis context (injects `tools`, `shell`, `sandboxPolicy`).
 * @param config - validated {@link Config}, seeded as the settings base layer.
 */
function apply(ctx, config) {
	const env = process.env;

	// Register the user-editable settings namespace when a settings provider is
	// mounted (the base layer always ships dsh-settings-file); the tools read
	// the resolved values at call time, so edits apply hot.
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), AuthSettingsSchema, { base: { ...config } });
	});

	ctx.tools.register(defineTool({
		name: "auth_status",
		description:
			"Read-only status of Git CLI authorizations and SSH keys: whether gh and glab are logged in (and as which account), SSH-agent keys, and the public keys present under ~/.ssh. No arguments. Use before signing in or when git operations fail with an auth error.",
		parameters: {},
		output: {
			schema: { type: "object", additionalProperties: false, properties: { text: { type: "string", required: true } } },
			render: (_a, value) => [{ type: "text", text: value.text }],
		},
		async execute(_args, exec) {
			return { text: await statusText(ctx, currentOptions(ctx, config), exec) };
		},
	}));

	ctx.tools.register(defineTool({
		name: "client_auth",
		description:
			"Non-interactively authorize gh (GitHub) or glab (GitLab) with a token from the client's environment variables, or sign out. Tokens are accepted only for the configured host and never enter tool arguments. Login and logout ask the user to approve the HOME credential mutation.",
		parameters: {
			client: { type: "string", required: true, enum: ["gh", "glab"], description: "Which CLI to authorize." },
			hostname: { type: "string", description: "Host to authenticate against (default from settings). It must match the configured host when logging in." },
			logout: { type: "boolean", description: "Sign out instead of signing in." },
		},
		output: {
			schema: { type: "object", additionalProperties: false, properties: { text: { type: "string", required: true } } },
			render: (_a, value) => [{ type: "text", text: value.text }],
		},
		async execute(args, exec) {
			return { text: await authTool(ctx, args, exec, currentOptions(ctx, config), env) };
		},
	}));

	ctx.tools.register(defineTool({
		name: "ssh_key",
		description:
			"Manage SSH keys for GitLab/GitHub authentication. \`action: generate\` asks for approval, creates an empty-passphrase ed25519 key directly under ~/.ssh, optionally loads it into ssh-agent, and prints the public key. \`action: list\` shows agent keys and public-key files. \`action: show\` prints one public key.",
		parameters: {
			action: { type: "string", required: true, enum: ["generate", "list", "show"], description: "What to do." },
			path: { type: "string", description: "Key path for generate/show; it must resolve to a direct child of ~/.ssh." },
			comment: { type: "string", description: "Key comment for generate, e.g. an email or host label (default from settings)." },
			add_agent: { type: "boolean", description: "Load the generated key into ssh-agent (generate only; default from settings)." },
		},
		output: {
			schema: { type: "object", additionalProperties: false, properties: { text: { type: "string", required: true } } },
			render: (_a, value) => [{ type: "text", text: value.text }],
		},
		async execute(args, exec) {
			return { text: await sshTool(ctx, args, exec, currentOptions(ctx, config), env) };
		},
	}));
}

export { AuthSettingsSchema, Config, SETTINGS_NAMESPACE, apply, inject, name };
export { assertSafeSshPath, composeAuthCommand, mergeOptions, normalizeHost, resolveSshPath, resolveToken, shellArg } from "./compose.js";
