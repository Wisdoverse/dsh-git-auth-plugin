/**
 * dsh-git-auth — host tool bundle for glab / gh credential and SSH key
 * management.
 *
 * Tool plugin (Cordis): exports `name`, `inject`, `Config`, `apply`. Registers
 * three model-facing tools and one user-editable settings namespace:
 *   - auth_status   read-only status of gh, glab, and the SSH agent/keys
 *   - client_auth   non-interactive gh/glab login (token via stdin) or logout
 *   - ssh_key       generate / configure / list / show workspace keys
 *
 * All commands run through the host `ctx.shell` seam with the calling
 * session's sandbox policy and cancellation signal.
 * @module dsh-git-auth
 */
import z from "@deepseek-ai/schemastery";
import { dirname, isAbsolute, resolve } from "node:path";
import { approveEscalation, sandboxDenialMarker } from "@deepseek-ai/dsh-sandbox";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import { assertSafeSshPath, composeAuthCommand, composeGitSshConfigCommand, mergeOptions, normalizeHost, resolveSshPath, resolveToken, shellArg } from "./compose.js";

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
	sshPath: z.string().default("").description("Default key path under each workspace (empty -> <workspace>/.ssh/id_ed25519)."),
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

/** Resolve the current DSH workspace from the immutable session header. */
function currentWorkspace(exec) {
	const cwd = exec.agent?.session?.header?.cwd;
	if (typeof cwd !== "string" || !isAbsolute(cwd)) throw new Error("the tool call has no absolute session workspace");
	return resolve(cwd);
}

/** Ask before widening a mutation beyond the session's current access mode. */
async function authorizeMutation(ctx, exec, toolName, requestedMode, justification) {
	const policy = currentSandboxPolicy(ctx, exec);
	if (policy.mode === "danger-full-access" || policy.mode === requestedMode) return policy;
	const mode = await approveEscalation({
		requestedMode,
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
	parts.push("## GitHub CLI (gh, shared by this DSH instance)\n" + await run(ctx, "gh auth status", { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy }));
	parts.push("## GitLab CLI (glab, shared by this DSH instance)\n" + await run(ctx, "glab auth status", { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy }));
	parts.push(await sshStatusText(ctx, opts, exec, sandboxPolicy));
	return parts.join("\n");
}

async function sshStatusText(ctx, opts, exec, sandboxPolicy = currentSandboxPolicy(ctx, exec)) {
	const workspace = currentWorkspace(exec);
	const root = resolve(workspace, ".ssh");
	const parts = [];
	parts.push(`## Workspace\n${workspace}`);
	parts.push("## SSH-agent keys (shared by this DSH instance)\n" + await run(ctx, "ssh-add -l", { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy }));
	parts.push("## Workspace public key files\n" + await run(ctx, `for f in ${shellArg(root)}/*.pub; do [ -f \"$f\" ] && printf '%s\\n' \"$f\"; done; true`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy }));
	parts.push("## Workspace Git core.sshCommand\n" + await run(ctx, `git -C ${shellArg(workspace)} config --local --get core.sshCommand 2>/dev/null || printf '%s\\n' '(not configured)'`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy }));
	return parts.join("\n");
}

// ── client_auth ─────────────────────────────────────────────────────────────

async function authTool(ctx, args, exec, opts, env) {
	const client = args.client;
	const configuredHost = client === "gh" ? opts.ghHost : opts.glabHost;
	const host = normalizeHost(args.hostname ?? configuredHost);
	if (args.logout) {
		const sandboxPolicy = await authorizeMutation(ctx, exec, "client_auth", "danger-full-access", `Allow ${client} to update credentials for ${host} under HOME.`);
		const { command } = composeAuthCommand(client, host, true);
		return await run(ctx, command, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	}
	const credentials = ctx.get("credentials");
	const token = await resolveToken(client, env, host, configuredHost,
		credentials === undefined ? undefined : async (ref) => (await credentials.resolve(ref))?.value);
	if (!token) {
		throw new Error(`no token available for ${client}: set ${client === "gh" ? "GH_TOKEN/GITHUB_TOKEN" : "GITLAB_TOKEN/GLAB_TOKEN/GITLAB_ACCESS_TOKEN"}`);
	}
	const sandboxPolicy = await authorizeMutation(ctx, exec, "client_auth", "danger-full-access", `Allow ${client} to update credentials for ${host} under HOME.`);
	const { command } = composeAuthCommand(client, host, false);
	return await run(ctx, command, { stdin: token, signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
}

// ── ssh_key ─────────────────────────────────────────────────────────────────

async function sshTool(ctx, args, exec, opts) {
	const { action } = args;

	if (action === "list") return await sshStatusText(ctx, opts, exec);
	const workspace = currentWorkspace(exec);
	const path = resolveSshPath(workspace, args.path ?? opts.sshPath);
	assertSafeSshPath(path);
	if (action === "show") {
		return await run(ctx, `cat -- ${shellArg(`${path}.pub`)}`, {
			signal: exec.signal,
			timeoutMs: opts.commandTimeoutMs,
			sandboxPolicy: currentSandboxPolicy(ctx, exec),
			check: true,
		});
	}
	if (action === "configure") {
		const sandboxPolicy = await authorizeMutation(ctx, exec, "ssh_key", "workspace-write", "Allow ssh_key to configure this workspace's Git repository to use its deploy key.");
		await run(ctx, `test -f ${shellArg(path)}`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
		await run(ctx, composeGitSshConfigCommand(workspace, path), { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
		return "## Workspace Git core.sshCommand\n" + await run(ctx, `git -C ${shellArg(workspace)} config --local --get core.sshCommand`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	}
	// generate (default): ssh-keygen -t ed25519, optionally ssh-add, then the
	// public key so the user can paste it into GitLab/GitHub.
	const sandboxPolicy = await authorizeMutation(ctx, exec, "ssh_key", "workspace-write", "Allow ssh_key to create an SSH deploy key in this workspace.");
	await run(ctx, `if [ -e ${shellArg(path)} ] || [ -e ${shellArg(`${path}.pub`)} ]; then printf '%s\\n' 'SSH key already exists; use action=show or action=configure.' >&2; exit 1; fi`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	let gen = `ssh-keygen -t ed25519 -N '' -f ${shellArg(path)}`;
	const comment = args.comment ?? opts.sshComment;
	if (comment) gen += ` -C ${shellArg(comment)}`;
	let out = await run(ctx, `install -d -m 700 -- ${shellArg(dirname(path))}`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	assertSafeSshPath(path);
	out += "\n" + await run(ctx, gen, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	out += "\n" + await run(ctx, `if git -C ${shellArg(workspace)} rev-parse --git-dir >/dev/null 2>&1; then ${composeGitSshConfigCommand(workspace, path)} && printf '%s\\n' 'Configured this repository to use the workspace deploy key.'; else printf '%s\\n' 'Workspace is not a Git repository; run action=configure after cloning or initializing it.'; fi`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy, check: true });
	const addAgent = args.add_agent ?? opts.sshAddAgent;
	if (addAgent) {
		const agentPolicy = await authorizeMutation(ctx, exec, "ssh_key", "danger-full-access", "Allow ssh_key to load this workspace key into the DSH host's shared SSH agent.");
		out += "\n" + await run(ctx, `ssh-add ${shellArg(path)}`, { signal: exec.signal, timeoutMs: opts.commandTimeoutMs, sandboxPolicy: agentPolicy, check: true });
	}
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
			"Read-only status of Git authorization: shared gh/glab login and SSH-agent state, plus public keys and core.sshCommand for the current workspace. No arguments. Use before signing in or when git operations fail with an auth error.",
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
			"Manage a workspace-local SSH deploy key for GitLab/GitHub. Paths resolve directly under <workspace>/.ssh. \`generate\` creates an empty-passphrase ed25519 key, configures the current Git repository to use it with workspace-local known_hosts, and prints the public key. \`configure\` binds an existing key through the repository's local core.sshCommand. \`list\` shows the current workspace and shared agent status. \`show\` prints one public key. Tokens and SSH-agent state remain shared by this single-user DSH instance.",
		parameters: {
			action: { type: "string", required: true, enum: ["generate", "configure", "list", "show"], description: "What to do." },
			path: { type: "string", description: "Key path for generate/configure/show; it must resolve to a direct child of <workspace>/.ssh." },
			comment: { type: "string", description: "Key comment for generate, e.g. an email or host label (default from settings)." },
			add_agent: { type: "boolean", description: "Load the generated key into ssh-agent (generate only; default from settings)." },
		},
		output: {
			schema: { type: "object", additionalProperties: false, properties: { text: { type: "string", required: true } } },
			render: (_a, value) => [{ type: "text", text: value.text }],
		},
		async execute(args, exec) {
			return { text: await sshTool(ctx, args, exec, currentOptions(ctx, config)) };
		},
	}));
}

export { AuthSettingsSchema, Config, SETTINGS_NAMESPACE, apply, inject, name };
export { assertSafeSshPath, composeAuthCommand, composeGitSshConfigCommand, mergeOptions, normalizeHost, resolveSshPath, resolveToken, shellArg } from "./compose.js";
