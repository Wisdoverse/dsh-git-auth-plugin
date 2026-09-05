/**
 * Pure command/option composition for the dsh-git-auth tools. Kept free of
 * DSH services so it can be self-checked with plain Node (test/compose.test.js).
 * @module dsh-git-auth/lib/compose
 */
import { lstatSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_HOST = { gh: "github.com", glab: "gitlab.com" };
export const TOKEN_REFS = {
	gh: ["GH_TOKEN", "GITHUB_TOKEN"],
	glab: ["GITLAB_TOKEN", "GLAB_TOKEN", "GITLAB_ACCESS_TOKEN"],
};

/** @typedef {{ghHost: string, glabHost: string, commandTimeoutMs: number, sshPath: string, sshComment: string, sshAddAgent: boolean}} Options */

/** Built-in defaults; the settings namespace and user document layer on top. */
export const DEFAULTS = {
	ghHost: "github.com",
	glabHost: "gitlab.com",
	commandTimeoutMs: 60000,
	sshPath: "",
	sshComment: "",
	sshAddAgent: false,
};

/**
 * Layer resolved options with DSH settings precedence:
 * schema defaults < entry config < user settings document.
 * @param base - entry config (or empty).
 * @param overlay - user settings section (or empty).
 * @returns a complete {@link Options}.
 */
export function mergeOptions(base, overlay) {
	return { ...DEFAULTS, ...(base ?? {}), ...(overlay ?? {}) };
}

/** Normalize and validate a bare gh/glab hostname (optionally with a port). */
export function normalizeHost(hostname) {
	const value = String(hostname ?? "").trim();
	if (!/^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?::[0-9]{1,5})?$/.test(value)) {
		throw new Error(`invalid authentication hostname: ${value || "(empty)"}`);
	}
	let url;
	try {
		url = new URL(`https://${value}`);
	} catch {
		throw new Error(`invalid authentication hostname: ${value}`);
	}
	if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
		throw new Error(`invalid authentication hostname: ${value}`);
	}
	return url.host.toLowerCase();
}

/** Encode one value as one literal POSIX-shell argument. */
export function shellArg(value) {
	const text = String(value);
	if (text.includes("\0")) throw new Error("shell argument must not contain NUL");
	return `'${text.replaceAll("'", `'"'"'`)}'`;
}

/** Resolve a key path and keep it as a direct child of the workspace's .ssh directory. */
export function resolveSshPath(workspace, requested) {
	if (!workspace || !isAbsolute(workspace)) throw new Error("workspace must be an absolute path");
	const root = resolve(workspace, ".ssh");
	const input = String(requested ?? "").trim();
	let value;
	if (!input) value = resolve(root, "id_ed25519");
	else if (input.startsWith("~/.ssh/")) value = resolve(root, input.slice(7));
	else if (input.startsWith(".ssh/")) value = resolve(workspace, input);
	else if (!isAbsolute(input)) value = resolve(root, input);
	else value = resolve(input);
	if (dirname(value) !== root) throw new Error(`SSH key path must be directly under ${root}`);
	const filename = basename(value).toLowerCase();
	if (filename.endsWith(".pub") || [".gitignore", "known_hosts"].includes(filename)) throw new Error("SSH private-key filename is reserved; choose a name without a .pub suffix.");
	return value;
}

/** Keep file contents inside the sandbox; the subprocess only emits public data. */
export function composeSshFilesCommand(action, path) {
	return `${shellArg(process.execPath)} ${shellArg(fileURLToPath(new URL("./ssh-files.js", import.meta.url)))} ${shellArg(action)} ${shellArg(path)}`;
}

/** Configure the current Git repository to use one workspace deploy key. */
export function composeGitSshConfigCommand(workspace, path) {
	const knownHosts = resolve(workspace, ".ssh", "known_hosts");
	const sshCommand = `ssh -i ${shellArg(path)} -o IdentitiesOnly=yes -o ${shellArg(`UserKnownHostsFile=${knownHosts}`)} -o StrictHostKeyChecking=accept-new`;
	return `git -C ${shellArg(workspace)} config --local core.sshCommand ${shellArg(sshCommand)}`;
}

/** Reject symlinks that could redirect an approved key operation outside the workspace. */
export function assertSafeSshPath(path) {
	for (const value of [dirname(path), path, `${path}.pub`, resolve(dirname(path), "known_hosts"), resolve(dirname(path), ".gitignore")]) {
		try {
			if (lstatSync(value).isSymbolicLink()) throw new Error(`SSH key path must not contain symlinks: ${value}`);
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
	}
}

/**
 * Compose the non-interactive auth command for gh or glab.
 * @param client - "gh" or "glab".
 * @param hostname - the git host (defaults per client).
 * @param logout - compose a logout command when true.
 * @returns the shell `command` string (login feeds the token via stdin).
 */
export function composeAuthCommand(client, hostname, logout) {
	const host = shellArg(normalizeHost(hostname ?? DEFAULT_HOST[client]));
	if (logout) {
		return { command: client === "gh" ? `gh auth logout --hostname ${host}` : `glab auth logout --hostname ${host}` };
	}
	if (client === "gh") {
		return { command: `gh auth login --hostname ${host} --git-protocol https --with-token` };
	}
	return { command: `glab auth login --hostname ${host} --git-protocol https --stdin` };
}

/**
 * Resolve a login token from well-known environment variables.
 * @param client - "gh" or "glab".
 * @param env - the environment map to read defaults from.
 * @param hostname - the selected destination host.
 * @param configuredHost - the host trusted to receive ambient credentials.
 * @param resolveCredential - optional DSH credential-reference resolver.
 * @returns the token, or undefined when none is available.
 */
export async function resolveToken(client, env, hostname, configuredHost, resolveCredential) {
	if (hostname !== undefined && configuredHost !== undefined && normalizeHost(hostname) !== normalizeHost(configuredHost)) {
		throw new Error(`token is only allowed for configured host ${normalizeHost(configuredHost)}; update the plugin host setting before authenticating to ${normalizeHost(hostname)}`);
	}
	for (const ref of TOKEN_REFS[client]) {
		const value = resolveCredential === undefined ? env[ref] : await resolveCredential(ref);
		if (value) return value;
	}
}
