/**
 * Pure command/option composition for the dsh-git-auth tools. Kept free of
 * DSH services so it can be self-checked with plain Node (test/compose.test.js).
 * @module dsh-git-auth/lib/compose
 */
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export const DEFAULT_HOST = { gh: "github.com", glab: "gitlab.com" };

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

/** Resolve a key path and keep it as a direct child of HOME/.ssh. */
export function resolveSshPath(home, requested) {
	if (!home || !isAbsolute(home)) throw new Error("HOME must be an absolute path");
	const root = resolve(home, ".ssh");
	let value = requested || resolve(root, "id_ed25519");
	if (value.startsWith("~/")) value = resolve(home, value.slice(2));
	else if (!isAbsolute(value)) value = resolve(root, value);
	else value = resolve(value);
	if (dirname(value) !== root) throw new Error(`SSH key path must be directly under ${root}`);
	return value;
}

/** Reject symlinks that could redirect an approved key operation outside HOME/.ssh. */
export function assertSafeSshPath(path) {
	for (const value of [dirname(path), path, `${path}.pub`]) {
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
 * @returns the token, or undefined when none is available.
 */
export function resolveToken(client, env, hostname, configuredHost) {
	if (hostname !== undefined && configuredHost !== undefined && normalizeHost(hostname) !== normalizeHost(configuredHost)) {
		throw new Error(`environment token is only allowed for configured host ${normalizeHost(configuredHost)}; update the plugin host setting before authenticating to ${normalizeHost(hostname)}`);
	}
	if (client === "gh") return env.GH_TOKEN ?? env.GITHUB_TOKEN;
	return env.GITLAB_TOKEN ?? env.GLAB_TOKEN ?? env.GITLAB_ACCESS_TOKEN;
}
