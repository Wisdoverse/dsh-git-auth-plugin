import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSafeSshPath, composeAuthCommand, mergeOptions, normalizeHost, resolveSshPath, resolveToken, shellArg, DEFAULTS } from "../lib/compose.js";

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
assert.equal(composeAuthCommand("glab", "gitlab.itoy.ai", false).command,
	"glab auth login --hostname 'gitlab.itoy.ai' --git-protocol https --stdin");
assert.equal(composeAuthCommand("glab", "gitlab.itoy.ai", true).command,
	"glab auth logout --hostname 'gitlab.itoy.ai'");

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

// SSH paths stay as direct children of HOME/.ssh; common spellings remain valid.
assert.equal(resolveSshPath("/home/test", undefined), "/home/test/.ssh/id_ed25519");
assert.equal(resolveSshPath("/home/test", "~/.ssh/work"), "/home/test/.ssh/work");
assert.equal(resolveSshPath("/home/test", "work"), "/home/test/.ssh/work");
assert.throws(() => resolveSshPath("/home/test", "/tmp/key"), /directly under/);
assert.throws(() => resolveSshPath("/home/test", "nested/key"), /directly under/);

const temp = mkdtempSync(join(tmpdir(), "dsh-git-auth-"));
try {
	symlinkSync(tmpdir(), join(temp, ".ssh"));
	assert.throws(() => assertSafeSshPath(join(temp, ".ssh", "id_ed25519")), /must not contain symlinks/);
} finally {
	rmSync(temp, { recursive: true, force: true });
}

for (const invalidHost of ["https://github.com", "user@github.com", "github.com/path", "github.com\\evil", "github。com", "github.com."]) {
	assert.throws(() => normalizeHost(invalidHost), /invalid authentication hostname/);
}

// options layering: defaults < entry config < user settings
const opts = mergeOptions({ ghHost: "ghe.corp", commandTimeoutMs: 5000 }, { ghHost: "github.dev", sshAddAgent: true });
assert.equal(opts.ghHost, "github.dev", "user settings overrides entry config");
assert.equal(opts.glabHost, "gitlab.com", "unset stays at default");
assert.equal(opts.commandTimeoutMs, 5000, "entry config survives when user leaves it");
assert.equal(opts.sshAddAgent, true, "user bool sticks");
assert.equal(mergeOptions(undefined, undefined).sshPath, DEFAULTS.sshPath, "no overrides = defaults");

console.log("compose.test: all assertions passed");
