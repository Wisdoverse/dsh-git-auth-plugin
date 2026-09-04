/**
 * dsh-git-auth browser half: claims the "git-auth" card in Settings >
 * Plugins. Hand-written __ModuleLoader__ bundle (no build step); the only
 * external is the module table's react entry. The settingsScope service
 * (dsh-client-ui-settings) supplies read/write access to the section the
 * host plugin registers, so this file ships no schema of its own.
 */
window.__ModuleLoader__.load({
	id: "dsh-git-auth",
	factory: (require) => {
		const React = require("react");
		const e = React.createElement;

		const NS = "git-auth";
		const FIELDS = [
			{ field: "ghHost", label: "GitHub 主机 (ghHost)", kind: "text" },
			{ field: "glabHost", label: "GitLab 主机 (glabHost)", kind: "text" },
			{ field: "commandTimeoutMs", label: "命令超时 ms (commandTimeoutMs)", kind: "number", min: 1 },
			{ field: "sshPath", label: "SSH key 路径 (sshPath)", kind: "text", hint: "留空 -> ~/.ssh/id_ed25519" },
			{ field: "sshComment", label: "Key 注释 (sshComment)", kind: "text", hint: "如 you@example.com" },
			{ field: "sshAddAgent", label: "生成 key 后自动 ssh-add (sshAddAgent)", kind: "bool" },
		];

		const inputStyle = { flex: 1, minWidth: 0, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--dsw-alias-border-primary, #8884)" };
		const rowStyle = { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 };
		const labelStyle = { width: 260, flexShrink: 0, fontSize: 13 };

		function seed(value) {
			const drafts = {};
			for (const f of FIELDS) drafts[f.field] = f.kind === "bool" ? value[f.field] === true : String(value[f.field] ?? "");
			return drafts;
		}

		function Card({ scope }) {
			const snap = React.useSyncExternalStore((cb) => scope.subscribe(cb), () => scope.getSnapshot());
			const [drafts, setDrafts] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			const ready = snap?.status === "ready" && drafts !== null;
			React.useEffect(() => {
				if (snap?.status === "ready" && drafts === null) setDrafts(seed(snap.value ?? {}));
			}, [snap?.status, drafts]);

			if (snap !== undefined && snap.status !== "ready") {
				return e("div", null, `git-auth 设置不可用 (${snap.status})`);
			}
			if (!ready) return e("div", null, "…");

			const value = snap.value ?? {};
			const dirty = FIELDS.some((f) => {
				if (f.kind === "bool") return Boolean(drafts[f.field]) !== (value[f.field] === true);
				const current = String(value[f.field] ?? "");
				return (drafts[f.field] ?? "") !== (f.kind === "number" && current === "" ? "" : current);
			});

			const save = async () => {
				setBusy(true);
				setError("");
				try {
					for (const f of FIELDS) {
						if (f.kind === "bool") {
							if (Boolean(drafts[f.field]) !== (value[f.field] === true)) await scope.set(f.field, drafts[f.field]);
						} else if (drafts[f.field] !== String(value[f.field] ?? "")) {
							await scope.set(f.field, f.kind === "number" ? Number(drafts[f.field] || 0) : drafts[f.field]);
						}
					}
				} catch (err) {
					setError(String(err?.message ?? err));
				} finally {
					setBusy(false);
				}
			};
			const reset = async () => {
				setBusy(true);
				setError("");
				try {
					for (const key of Object.keys(snap.user ?? {})) await scope.unset(key);
					setDrafts(null);
				} catch (err) {
					setError(String(err?.message ?? err));
				} finally {
					setBusy(false);
				}
			};

			return e("div", { style: { padding: "4px 0" } },
				FIELDS.map((f) => e("div", { key: f.field, style: rowStyle },
					e("label", { style: labelStyle }, f.label),
					f.kind === "bool"
						? e("input", { type: "checkbox", checked: Boolean(drafts[f.field]), disabled: busy, onChange: (ev) => setDrafts({ ...drafts, [f.field]: ev.target.checked }) })
						: e("input", { type: f.kind === "number" ? "number" : "text", min: f.min, style: inputStyle, value: drafts[f.field] ?? "", placeholder: f.hint ?? "", disabled: busy, onChange: (ev) => setDrafts({ ...drafts, [f.field]: ev.target.value }) }),
					Object.hasOwn(snap.user ?? {}, f.field) ? e("span", { title: "用户覆盖,重置可恢复默认", style: { fontSize: 11, opacity: 0.7 } }, "●") : null,
				)),
				e("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
					e("button", { type: "button", onClick: save, disabled: busy || !dirty }, busy ? "保存中…" : "保存"),
					e("button", { type: "button", onClick: reset, disabled: busy || Object.keys(snap.user ?? {}).length === 0 }, "重置为默认"),
					dirty ? e("span", { style: { fontSize: 12, opacity: 0.7 } }, "有未保存修改") : null,
					error ? e("span", { style: { fontSize: 12, color: "#e5484d" } }, error) : null,
				),
			);
		}

		const inject = ["slots", "settingsScope"];
		function apply(ctx) {
			const scope = ctx.settingsScope.bind({ namespace: NS });
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: NS,
			}, () => e(Card, { scope })));
		}
		return { name: "dsh-git-auth", inject, apply };
	},
});
