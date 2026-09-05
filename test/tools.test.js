import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply } from "../lib/index.js";

const workspace = mkdtempSync(join(tmpdir(), "dsh-git-auth-tools-"));
const registered = new Map();
const policies = [];
let corruptGeneratedPublic = false;
const ctx = {
	get() {},
	inject() {},
	tools: { register(tool) { registered.set(tool.name, tool); } },
	sandboxPolicy: { resolve() { return { mode: "workspace-write" }; } },
	shell: {
		resolve(request) { return request; },
		async run(request) {
			policies.push(request.sandboxPolicy.mode);
			const result = spawnSync("bash", ["-c", request.command], { encoding: "utf8", input: request.stdin, timeout: request.timeoutMs });
			if (corruptGeneratedPublic && request.command.startsWith("ssh-keygen ")) {
				copyFileSync(join(workspace, ".ssh", "tampered"), join(workspace, ".ssh", "tampered.pub"));
			}
			return { stdout: { text: result.stdout }, stderr: { text: result.stderr }, exitCode: result.status, signal: result.signal, timedOut: result.error?.code === "ETIMEDOUT" };
		},
	},
};
apply(ctx, {});
const exec = { agent: { session: { header: { cwd: workspace } } } };
const call = (args) => registered.get("ssh_key").execute(args, exec);
try {
	assert.equal(spawnSync("git", ["init", "-q", workspace]).status, 0);
	await assert.rejects(call({ action: "generate", path: "deploy.pub" }), /reserved/);
	assert.ok(!existsSync(join(workspace, ".ssh", "deploy.pub")));
	const generated = await call({ action: "generate", comment: "test-key" });
	assert.ok(generated.text.includes("ssh-ed25519 "));
	assert.ok(!generated.text.includes("PRIVATE KEY"));
	const key = join(workspace, ".ssh", "id_ed25519");
	const shown = await call({ action: "show" });
	assert.equal(shown.text.trim(), readFileSync(`${key}.pub`, "utf8").trim().split(/\s+/).slice(0, 2).join(" "));
	await call({ action: "configure" });
	assert.equal(spawnSync("git", ["-C", workspace, "add", "-A"]).status, 0);
	assert.equal(spawnSync("git", ["-C", workspace, "ls-files"], { encoding: "utf8" }).stdout, "");
	copyFileSync(key, join(workspace, ".ssh", "legacy.pub"));
	await assert.rejects(call({ action: "show", path: "legacy" }), (error) => !error.message.includes("PRIVATE KEY") && error.message.includes("Expected one OpenSSH public key"));
	// The generation output uses the same content guard as show.
	corruptGeneratedPublic = true;
	await assert.rejects(call({ action: "generate", path: "tampered", comment: "test-key" }), (error) => !error.message.includes("PRIVATE KEY") && error.message.includes("Expected one OpenSSH public key"));
	corruptGeneratedPublic = false;
	assert.equal(spawnSync("git", ["-C", workspace, "add", "-f", "--", key]).status, 0);
	await assert.rejects(call({ action: "configure" }), /already tracked/);
	await assert.rejects(call({ action: "generate", path: "another" }), /already tracked/);
	assert.ok(!existsSync(join(workspace, ".ssh", "another")), "no new private key before exclusion succeeds");
	assert.ok(policies.every((mode) => mode === "workspace-write"), "file operations retain the session policy");
	console.log("tools.test: all assertions passed");
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
