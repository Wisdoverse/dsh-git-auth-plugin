import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeSshPath, composeAuthCommand, composeGitSshConfigCommand, composeSshFilesCommand, mergeOptions, normalizeHost, resolveSshPath, resolveToken, shellArg, DEFAULTS } from "../lib/compose.js";

// gh login default + custom host
assert.equal(composeAuthCommand("gh", undefined, false).command,
	"gh auth login --hostname 'github.com' --git-protocol https --with-token");
assert.equal(composeAuthCommand("gh", "ghe.corp", false).command,
	"gh auth login --hostname 'ghe.corp' --git-protocol https --with-token");
// gh logout
assert.equal(composeAuthCommand("gh", "ghe.corp", true).command,
	"gh auth logout --hostname 'ghe.corp'");

// glab login uses --stdin (token via stdin), default host gitlab.com
assert.equal(composeAuthCommand("glab", undefined, false).command,
	"glab auth login --hostname 'gitlab.com' --git-protocol https --stdin");
assert.equal(composeAuthCommand("glab", "gitlab.example.com", false).command,
	"glab auth login --hostname 'gitlab.example.com' --git-protocol https --stdin");
assert.equal(composeAuthCommand("glab", "gitlab.example.com", true).command,
	"glab auth logout --hostname 'gitlab.example.com'");

// host validation + shell argument round-trip
assert.equal(normalizeHost("GITHUB.COM:443"), "github.com");
assert.throws(() => composeAuthCommand("gh", "github.com; touch /tmp/pwn", false), /invalid authentication hostname/);
const hostile = "key '\"; $(printf pwned); `printf nope`; \\\nnext";
const printed = spawnSync("bash", ["-c", `printf %s ${shellArg(hostile)}`], { encoding: "utf8" });
assert.equal(printed.status, 0);
assert.equal(printed.stdout, hostile, "shellArg keeps hostile text as one literal argument");

// token resolution: DSH credentials or environment, per client and configured host
assert.equal(await resolveToken("gh", { GITHUB_TOKEN: "env" }), "env");
assert.equal(await resolveToken("gh", { GH_TOKEN: "g", GITHUB_TOKEN: "e" }), "g");
assert.equal(await resolveToken("glab", { GITLAB_TOKEN: "l" }), "l");
assert.equal(await resolveToken("glab", { GLAB_TOKEN: "lb" }), "lb");
assert.equal(await resolveToken("glab", {}), undefined);
assert.equal(await resolveToken("gh", {}, undefined, undefined,
	async (ref) => ref === "GH_TOKEN" ? "stored" : undefined), "stored");
assert.equal(await resolveToken("glab", {}, undefined, undefined,
	async (ref) => ref === "GLAB_TOKEN" ? "stored" : undefined), "stored");
await assert.rejects(resolveToken("gh", { GH_TOKEN: "g" }, "evil.example", "github.com"), /update the plugin host setting/);

// SSH paths stay as direct children of the current workspace's .ssh directory.
assert.equal(resolveSshPath("/workspace/repo", undefined), "/workspace/repo/.ssh/id_ed25519");
assert.equal(resolveSshPath("/workspace/repo", "~/.ssh/work"), "/workspace/repo/.ssh/work");
assert.equal(resolveSshPath("/workspace/repo", ".ssh/work"), "/workspace/repo/.ssh/work");
assert.equal(resolveSshPath("/workspace/repo", "work"), "/workspace/repo/.ssh/work");
assert.equal(resolveSshPath("/workspace/repo", "/workspace/repo/.ssh/work"), "/workspace/repo/.ssh/work");
assert.throws(() => resolveSshPath("/workspace/repo", "/tmp/key"), /directly under/);
assert.throws(() => resolveSshPath("/workspace/repo", "nested/key"), /directly under/);
assert.throws(() => resolveSshPath("relative", "work"), /workspace must be an absolute path/);
for (const name of ["deploy.pub", "DEPLOY.PUB", ".ssh/deploy.pub", "~/.ssh/deploy.pub", ".gitignore", "known_hosts", "KNOWN_HOSTS"]) {
	assert.throws(() => resolveSshPath("/workspace/repo", name), /reserved/);
}

// The generated repository-local setting survives both shell parses intact.
const repo = mkdtempSync(join(tmpdir(), "dsh-git-auth-repo-"));
try {
	assert.equal(spawnSync("git", ["init", "-q", repo]).status, 0);
	const key = join(repo, ".ssh", "deploy ' key");
	const configured = spawnSync("bash", ["-c", composeGitSshConfigCommand(repo, key)], { encoding: "utf8" });
	assert.equal(configured.status, 0, configured.stderr);
	const value = spawnSync("git", ["-C", repo, "config", "--local", "--get", "core.sshCommand"], { encoding: "utf8" });
	assert.equal(value.status, 0, value.stderr);
	assert.equal(value.stdout.trim(), `ssh -i ${shellArg(key)} -o IdentitiesOnly=yes -o ${shellArg(`UserKnownHostsFile=${join(repo, ".ssh", "known_hosts")}`)} -o StrictHostKeyChecking=accept-new`);
} finally {
	rmSync(repo, { recursive: true, force: true });
}

const temp = mkdtempSync(join(tmpdir(), "dsh-git-auth-symlink-"));
try {
	symlinkSync(tmpdir(), join(temp, ".ssh"));
	assert.throws(() => assertSafeSshPath(join(temp, ".ssh", "id_ed25519")), /must not contain symlinks/);
} finally {
	rmSync(temp, { recursive: true, force: true });
}

const knownHostsTemp = mkdtempSync(join(tmpdir(), "dsh-git-auth-known-hosts-"));
try {
	mkdirSync(join(knownHostsTemp, ".ssh"));
	symlinkSync(join(tmpdir(), "outside-known-hosts"), join(knownHostsTemp, ".ssh", "known_hosts"));
	assert.throws(() => assertSafeSshPath(join(knownHostsTemp, ".ssh", "id_ed25519")), /must not contain symlinks/);
} finally {
	rmSync(knownHostsTemp, { recursive: true, force: true });
}

for (const invalidHost of ["https://github.com", "user@github.com", "github.com/path", "github.com\\evil", "github。com", "github.com."]) {
	assert.throws(() => normalizeHost(invalidHost), /invalid authentication hostname/);
}

// Exercise the exact sandbox subprocess boundary, without any DSH dependencies.
const filesTemp = mkdtempSync(join(tmpdir(), "dsh-git-auth-files-"));
const cli = (command, args) => spawnSync(command, args, { encoding: "utf8" });
const fileCommand = (action, path) => cli("bash", ["-c", composeSshFilesCommand(action, path)]);
const success = (result) => assert.equal(result.status, 0, result.stderr);
try {
	const workspace = join(filesTemp, "workspace ' key");
	mkdirSync(workspace);
	// Protection precedes generation and also survives a later git init.
	success(fileCommand("protect", workspace));
	const key = join(workspace, ".ssh", "deploy ' key");
	success(cli("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "private-comment", "-f", key]));
	const pub = readFileSync(`${key}.pub`, "utf8");
	const expected = pub.trim().split(/\s+/).slice(0, 2).join(" ");
	const shown = fileCommand("public", `${key}.pub`);
	success(shown);
	assert.equal(shown.stdout.trim(), expected);
	// Public-only files remain supported; comments are intentionally not emitted.
	const publicOnly = join(workspace, ".ssh", "public-only.pub");
	copyFileSync(`${key}.pub`, publicOnly);
	success(fileCommand("public", publicOnly));
	// Existing or renamed private files must be rejected, even after the name guard.
	const confused = join(workspace, ".ssh", "legacy.pub");
	copyFileSync(key, confused);
	let rejected = fileCommand("public", confused);
	assert.notEqual(rejected.status, 0);
	assert.equal(rejected.stdout, "");
	assert.ok(!rejected.stderr.includes("PRIVATE KEY"));
	for (const bad of [pub + readFileSync(key, "utf8"), "ssh-ed25519 aGVsbG8=\n", "x".repeat(16385)]) {
		writeFileSync(confused, bad);
		rejected = fileCommand("public", confused);
		assert.notEqual(rejected.status, 0);
		assert.equal(rejected.stdout, "");
		assert.ok(!rejected.stderr.includes("PRIVATE KEY"));
	}
	// ssh-keygen validation also preserves existing RSA public-key support.
	const rsa = join(workspace, ".ssh", "rsa");
	success(cli("ssh-keygen", ["-q", "-t", "rsa", "-b", "2048", "-N", "", "-f", rsa]));
	success(fileCommand("public", `${rsa}.pub`));
	success(cli("git", ["init", "-q", workspace]));
	const ignore = join(workspace, ".ssh", ".gitignore");
	writeFileSync(ignore, "# keep existing rules\n!deploy*\n");
	success(fileCommand("protect", workspace));
	const protectedRules = readFileSync(ignore, "utf8");
	assert.ok(protectedRules.startsWith("# keep existing rules\n!deploy*\n"));
	success(fileCommand("protect", workspace));
	assert.equal(readFileSync(ignore, "utf8"), protectedRules, "protection is idempotent");
	writeFileSync(join(workspace, ".ssh", "known_hosts"), "fixture\n");
	success(cli("git", ["-C", workspace, "add", "-A"]));
	assert.equal(cli("git", ["-C", workspace, "ls-files"]).stdout, "", "ordinary staging excludes all SSH files");
	// Nested workspaces and linked worktrees have no assumed .git directory path.
	const nested = join(workspace, "nested");
	mkdirSync(nested);
	success(fileCommand("protect", nested));
	writeFileSync(join(nested, ".ssh", "key"), "fixture");
	success(cli("git", ["-C", workspace, "add", "-A"]));
	assert.equal(cli("git", ["-C", workspace, "ls-files"]).stdout, "");
	success(cli("git", ["-C", workspace, "-c", "user.name=Audit", "-c", "user.email=audit@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "fixture"]));
	const linked = join(filesTemp, "linked");
	success(cli("git", ["-C", workspace, "worktree", "add", "-q", "--detach", linked]));
	success(fileCommand("protect", linked));
	writeFileSync(join(linked, ".ssh", "key"), "fixture");
	success(cli("git", ["-C", linked, "add", "-A"]));
	assert.equal(cli("git", ["-C", linked, "ls-files"]).stdout, "");
	// Existing indexed secrets are not silently hidden or removed by ignore rules.
	success(cli("git", ["-C", workspace, "add", "-f", "--", key]));
	const tracked = fileCommand("protect", workspace);
	assert.notEqual(tracked.status, 0);
	assert.match(tracked.stderr, /already tracked/);
	assert.ok(cli("git", ["-C", workspace, "ls-files"]).stdout.includes("deploy ' key"));
	const gitConfig = join(workspace, ".git", "config");
	const configText = readFileSync(gitConfig, "utf8");
	writeFileSync(gitConfig, configText + "\n[broken config\n");
	assert.notEqual(fileCommand("protect", workspace).status, 0, "Git inspection errors must not be treated as a new workspace");
	writeFileSync(gitConfig, configText);
	const outside = join(filesTemp, "outside");
	writeFileSync(outside, "unchanged");
	const symlinkWorkspace = join(filesTemp, "symlink-workspace");
	mkdirSync(join(symlinkWorkspace, ".ssh"), { recursive: true });
	symlinkSync(outside, join(symlinkWorkspace, ".ssh", ".gitignore"));
	assert.throws(() => assertSafeSshPath(join(symlinkWorkspace, ".ssh", "key")), /symlinks/);
	assert.notEqual(fileCommand("protect", symlinkWorkspace).status, 0);
	assert.equal(readFileSync(outside, "utf8"), "unchanged");
} finally {
	rmSync(filesTemp, { recursive: true, force: true });
}

// options layering: defaults < entry config < user settings
const opts = mergeOptions({ ghHost: "ghe.corp", commandTimeoutMs: 5000 }, { ghHost: "github.dev", sshAddAgent: true });
assert.equal(opts.ghHost, "github.dev", "user settings overrides entry config");
assert.equal(opts.glabHost, "gitlab.com", "unset stays at default");
assert.equal(opts.commandTimeoutMs, 5000, "entry config survives when user leaves it");
assert.equal(opts.sshAddAgent, true, "user bool sticks");
assert.equal(mergeOptions(undefined, undefined).sshPath, DEFAULTS.sshPath, "no overrides = defaults");

console.log("compose.test: all assertions passed");
