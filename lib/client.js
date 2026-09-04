/**
 * dsh-git-auth browser half: claims the "git-auth" card in Settings >
 * Plugins. Hand-written __ModuleLoader__ bundle (no build step); React,
 * settingsScope, and connection are supplied by DSH.
 */
window.__ModuleLoader__.load({
	id: "dsh-git-auth",
	factory: (require) => {
		const React = require("react");
		const e = React.createElement;

		const NS = "git-auth";
		const FIELDS = [
			{ field: "ghHost", label: "GitHub host", kind: "text", fallback: "github.com", hint: "Bare hostname used by gh." },
			{ field: "glabHost", label: "GitLab host", kind: "text", fallback: "gitlab.com", hint: "Bare hostname used by glab." },
			{ field: "commandTimeoutMs", label: "Command timeout (ms)", kind: "number", fallback: 60000, hint: "Maximum time allowed for each CLI command." },
			{ field: "sshPath", label: "SSH key path", kind: "text", fallback: "", hint: "Leave blank to use ~/.ssh/id_ed25519." },
			{ field: "sshComment", label: "SSH key comment", kind: "text", fallback: "", hint: "For example, you@example.com." },
			{ field: "sshAddAgent", label: "Add generated key to ssh-agent", kind: "bool", fallback: false, hint: "Load newly generated keys into the active SSH agent." },
		];
		const TOKEN_FIELDS = [
			{ field: "ghToken", ref: "GH_TOKEN", label: "GitHub token" },
			{ field: "glabToken", ref: "GITLAB_TOKEN", label: "GitLab token" },
		];
		const CSS = `
.dga-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.dga-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dga-card.dga-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dga-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:none;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dga-header:focus-visible,.dga-button:focus-visible,.dga-reset:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dga-head-text{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dga-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dga-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dga-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.dga-open .dga-chevron{transform:rotate(180deg)}
.dga-pending,.dga-badge,.dga-badge-muted{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}
.dga-pending,.dga-badge{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-weight:500}
.dga-badge-muted{color:var(--dsw-alias-label-tertiary)}
.dga-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dga-readonly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.dga-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.dga-field+.dga-field{border-top:1px solid var(--dsw-alias-border-l2)}
.dga-field-head{align-items:center;gap:8px;display:flex}
.dga-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.dga-badges{align-items:center;gap:8px;display:inline-flex}
.dga-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:none;border:0;padding:0;font-size:12px;line-height:1.5}
.dga-input{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
.dga-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dga-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dga-input[aria-invalid=true]{border-color:var(--dsw-alias-label-error)}
.dga-check{color:var(--dsw-alias-label-secondary);align-items:center;gap:8px;min-height:34px;font-size:13px;display:flex}
.dga-check input{accent-color:var(--dsw-alias-brand-primary)}
.dga-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.dga-invalid,.dga-failed{color:var(--dsw-alias-label-error)}
.dga-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
.dga-failed{min-width:0;flex:1;margin:0;font-size:12px;line-height:1.5}
.dga-button{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dga-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:none}
.dga-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dga-button:disabled,.dga-reset:disabled{opacity:.4;cursor:default}
`;

		function ensureStyles() {
			let style = document.getElementById("dsh-git-auth-settings-css");
			if (!style) {
				style = document.createElement("style");
				style.id = "dsh-git-auth-settings-css";
				document.head.append(style);
			}
			style.textContent = CSS;
		}

		function shown(field, value) {
			return field.kind === "bool" ? value === true : String(value ?? "");
		}

		function seed(value) {
			return Object.fromEntries(FIELDS.map((field) => [field.field, shown(field, value[field.field])]));
		}

		async function credentialViews(api) {
			const response = await api.credentials.describe({ refs: TOKEN_FIELDS.map((field) => field.ref) });
			if (!response.result.ok) throw new Error(response.result.error.message);
			return response.result.value.credentials;
		}

		function Chevron() {
			return e("svg", { className: "dga-chevron", width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": true },
				e("path", { d: "M3 5l4 4 4-4", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }),
			);
		}

		function ValueField({ field, value, overridden, disabled, invalid, onChange, onReset }) {
			const id = `dga-${field.field}`;
			return e("div", { className: "dga-field" },
				e("div", { className: "dga-field-head" },
					e("label", { className: "dga-label", htmlFor: id }, field.label),
					overridden ? e("span", { className: "dga-badges" },
						e("span", { className: "dga-badge" }, "Overridden"),
						e("button", { className: "dga-reset", type: "button", disabled, onClick: onReset }, "Reset"),
					) : null,
				),
				field.kind === "bool"
					? e("label", { className: "dga-check", htmlFor: id },
						e("input", { id, type: "checkbox", checked: value === true, disabled, onChange: (event) => onChange(event.target.checked) }),
						e("span", null, "Enabled"),
					)
					: e("input", {
						id,
						className: "dga-input",
						type: "text",
						inputMode: field.kind === "number" ? "numeric" : undefined,
						value,
						disabled,
						"aria-invalid": invalid || undefined,
						onChange: (event) => onChange(event.target.value),
					}),
				e("p", { className: `dga-hint${invalid ? " dga-invalid" : ""}` }, invalid ? "Enter an integer greater than or equal to 1." : field.hint),
			);
		}

		function SecretField({ field, value, view, disabled, onChange }) {
			const id = `dga-${field.field}`;
			return e("div", { className: "dga-field" },
				e("div", { className: "dga-field-head" },
					e("label", { className: "dga-label", htmlFor: id }, field.label),
					e("span", { className: view?.configured ? "dga-badge" : "dga-badge-muted" }, view === undefined ? "Loading" : view.configured ? "Configured" : "Not configured"),
				),
				e("input", {
					id,
					className: "dga-input",
					type: "password",
					autoComplete: "off",
					value,
					placeholder: view?.configured ? "Enter a new token to replace it" : "Enter token",
					disabled,
					onChange: (event) => onChange(event.target.value),
				}),
				e("p", { className: "dga-hint" }, `${field.ref} is write-only and is never returned to the browser.${view !== undefined && view.writable !== true ? " This credential is read-only in this session." : ""}`),
			);
		}

		function Card({ scope, api }) {
			const snap = React.useSyncExternalStore((callback) => scope.subscribe(callback), () => scope.getSnapshot());
			const [open, setOpen] = React.useState(false);
			const [drafts, setDrafts] = React.useState(null);
			const [clears, setClears] = React.useState({});
			const [tokenDrafts, setTokenDrafts] = React.useState({});
			const [credentials, setCredentials] = React.useState({});
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState("");
			React.useEffect(() => {
				if (snap?.status === "ready" && drafts === null) setDrafts(seed(snap.value ?? {}));
			}, [snap, drafts]);
			React.useEffect(() => {
				let active = true;
				credentialViews(api).then((views) => {
					if (active) setCredentials(views);
				}, (err) => {
					if (active) setError(String(err?.message ?? err));
				});
				return () => { active = false; };
			}, [api]);

			if (snap?.status !== "ready" || drafts === null) return null;

			const value = snap.value ?? {};
			const user = snap.user ?? {};
			const changed = (field) => shown(field, drafts[field.field]) !== shown(field, value[field.field]);
			const settingsDirty = FIELDS.some((field) => clears[field.field] ? Object.hasOwn(user, field.field) : changed(field));
			const tokenDirty = TOKEN_FIELDS.some((field) => (tokenDrafts[field.field] ?? "").trim().length > 0);
			const invalid = !/^\d+$/.test(drafts.commandTimeoutMs) || !Number.isSafeInteger(Number(drafts.commandTimeoutMs)) || Number(drafts.commandTimeoutMs) < 1;
			const dirty = settingsDirty || tokenDirty;
			const settingsWritable = snap.writable === true;

			const edit = (field, next) => {
				setDrafts({ ...drafts, [field]: next });
				if (clears[field]) setClears({ ...clears, [field]: false });
			};
			const resetField = (field) => {
				const inherited = Object.hasOwn(snap.base ?? {}, field.field) ? snap.base[field.field] : field.fallback;
				setDrafts({ ...drafts, [field.field]: shown(field, inherited) });
				setClears({ ...clears, [field.field]: true });
			};
			const discard = () => {
				setDrafts(seed(value));
				setClears({});
				setTokenDrafts({});
				setError("");
			};
			const save = async () => {
				setBusy(true);
				setError("");
				try {
					for (const field of FIELDS) {
						if (clears[field.field]) {
							if (Object.hasOwn(user, field.field)) await scope.unset(field.field);
						} else if (changed(field)) {
							await scope.set(field.field, field.kind === "number" ? Number(drafts[field.field]) : drafts[field.field]);
						}
					}
					for (const field of TOKEN_FIELDS) {
						const token = (tokenDrafts[field.field] ?? "").trim();
						if (!token) continue;
						const response = await api.credentials.set({ ref: field.ref, value: token });
						if (!response.result.ok) throw new Error(response.result.error.message);
					}
					setClears({});
					setTokenDrafts({});
					setDrafts(null);
					if (tokenDirty) setCredentials(await credentialViews(api));
				} catch (err) {
					setError(String(err?.message ?? err));
				} finally {
					setBusy(false);
				}
			};

			return e("li", { className: `dga-card${open ? " dga-open" : ""}` },
				e("button", {
					className: "dga-header",
					type: "button",
					"aria-expanded": open,
					"aria-controls": "dga-settings-body",
					"aria-label": `${open ? "Collapse" : "Expand"} settings: Git authentication`,
					onClick: () => setOpen(!open),
				},
					e("span", { className: "dga-head-text" },
						e("span", { className: "dga-name" }, "Git authentication"),
						e("span", { className: "dga-description" }, "Manage GitHub/GitLab CLI hosts, tokens, and SSH key defaults."),
					),
					dirty ? e("span", { className: "dga-pending" }, "Unsaved") : null,
					e(Chevron),
			),
			open ? e("div", { className: "dga-body", id: "dga-settings-body" },
				!settingsWritable ? e("p", { className: "dga-readonly" }, "Settings are read-only in this session.") : null,
				FIELDS.map((field) => e(ValueField, {
					key: field.field,
					field,
					value: drafts[field.field],
					overridden: !clears[field.field] && (changed(field) || Object.hasOwn(user, field.field)),
					disabled: busy || !settingsWritable,
					invalid: field.kind === "number" && invalid,
					onChange: (next) => edit(field.field, next),
					onReset: () => resetField(field),
				})),
				TOKEN_FIELDS.map((field) => e(SecretField, {
					key: field.field,
					field,
					value: tokenDrafts[field.field] ?? "",
					view: credentials[field.ref],
					disabled: busy || credentials[field.ref]?.writable !== true,
					onChange: (next) => setTokenDrafts({ ...tokenDrafts, [field.field]: next }),
				})),
				e("div", { className: "dga-footer" },
					error ? e("p", { className: "dga-failed", role: "alert" }, error) : null,
					e("button", { className: "dga-button dga-discard", type: "button", disabled: busy || !dirty, onClick: discard }, "Discard"),
					e("button", { className: "dga-button dga-save", type: "button", disabled: busy || !dirty || invalid, onClick: save }, busy ? "Saving…" : "Save"),
				),
			) : null,
			);
		}

		const inject = ["slots", "settingsScope", "connection"];
		function apply(ctx) {
			ensureStyles();
			const scope = ctx.settingsScope.bind({ namespace: NS });
			const api = ctx.get("connection").api;
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: NS,
			}, () => e(Card, { scope, api })));
		}
		return { name: "dsh-git-auth", inject, apply };
	},
});
