/** File operations run as a subprocess through DSH's sandboxed shell seam. */
import { appendFileSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function publicKey(path) {
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	let text;
	try {
		if (!fstatSync(fd).isFile()) throw new Error("Expected a regular public-key file.");
		const bytes = Buffer.alloc(16385);
		const size = readSync(fd, bytes, 0, bytes.length, 0);
		if (size > 16384) throw new Error("Public-key file is too large.");
		text = bytes.subarray(0, size).toString("utf8").trim();
	} finally {
		closeSync(fd);
	}
	// Validate one entire OpenSSH public line; never echo comments or rejected input.
	const match = /^([A-Za-z0-9@._+-]+)[ \t]+([A-Za-z0-9+/]+={0,2})(?:[ \t]+[^\r\n]*)?$/.exec(text);
	if (!match) throw new Error("Expected one OpenSSH public key.");
	const key = `${match[1]} ${match[2]}`;
	const result = spawnSync("ssh-keygen", ["-l", "-f", "/dev/stdin"], { input: key + "\n", timeout: 5000 });
	if (result.error || result.status !== 0) throw new Error("Invalid OpenSSH public key.");
	return key;
}

function protectKeys(workspace) {
	const root = resolve(workspace, ".ssh");
	mkdirSync(root, { recursive: true, mode: 0o700 });
	if (lstatSync(root).isSymbolicLink()) throw new Error("SSH directory must not be a symlink.");
	const git = (args) => {
		const result = spawnSync("git", ["-C", workspace, ...args], { timeout: 5000, env: { ...process.env, LC_ALL: "C" } });
		if (result.error || result.signal) throw new Error("Could not inspect Git tracking state.");
		return result;
	};
	const repo = git(["rev-parse", "--is-inside-work-tree"]);
	if (repo.status === 0) {
		const tracked = git(["ls-files", "-z", "--", ".ssh/"]);
		if (tracked.status !== 0) throw new Error("Could not inspect Git tracking state.");
		if (tracked.stdout.length) throw new Error("Workspace .ssh files are already tracked by Git. Untrack them and rotate any published private key before retrying.");
	} else if (repo.status !== 128 || !repo.stderr.toString().startsWith("fatal: not a git repository")) {
		throw new Error("Could not inspect Git repository.");
	}
	const fd = openSync(resolve(root, ".gitignore"), constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
	try {
		if (!fstatSync(fd).isFile()) throw new Error("SSH ignore rules must be a regular file.");
		const rules = readFileSync(fd, "utf8");
		if (!/(?:^|\n)\*\r?\n?$/.test(rules)) appendFileSync(fd, `${rules.endsWith("\n") || !rules ? "" : "\n"}*\n`);
	} finally {
		closeSync(fd);
	}
}

try {
	const [action, path] = process.argv.slice(2);
	if (action === "public") console.log(publicKey(path));
	else if (action === "protect") protectKeys(path);
	else throw new Error("Unknown SSH file operation.");
} catch (error) {
	// Filesystem and CLI diagnostics can contain paths or untrusted file content.
	console.error(error.code ? "SSH file operation failed; check file type and permissions." : error.message);
	process.exitCode = 1;
}
