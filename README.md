<h1 align="center">dsh-git-auth</h1>

<p align="center">
  <strong>GitHub, GitLab, and SSH authentication tools for DeepSeek Harness</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/Wisdoverse/dsh-git-auth-plugin?style=flat-square"></a>
  <a href="package.json"><img alt="Top language" src="https://img.shields.io/github/languages/top/Wisdoverse/dsh-git-auth-plugin?style=flat-square"></a>
  <img alt="Token handling" src="https://img.shields.io/badge/tokens-write--only-2ea44f?style=flat-square">
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

Give DSH agents a small, approval-aware toolset for inspecting and managing
`gh`, `glab`, and SSH credentials on the host.

```text
Check authentication                 →  auth_status
Sign in with GH_TOKEN / GITLAB_TOKEN →  client_auth
Manage this workspace's deploy key   →  ssh_key
```

## Contents

- [Features](#features)
- [Tools](#tools)
- [Installation](#installation)
- [Configuration](#configuration)
- [Token handling](#token-handling)
- [Security](#security)
- [Development](#development)
- [License](#license)

## Features

| Feature | Description |
| --- | --- |
| Unified status | Reports `gh`, `glab`, SSH-agent, and public-key status in one call. |
| Non-interactive login | Authenticates `gh` or `glab` with a token from plugin settings or the DSH host environment. |
| Workspace deploy keys | Generates, configures, lists, and displays Ed25519 keys under each workspace's `.ssh` directory. |
| Approval-aware writes | Keeps key changes inside workspace access and requests host approval for shared CLI/agent changes. |
| Settings UI | Exposes hosts, timeout, key path, comment, and `ssh-add` defaults under **Settings → Plugins**. |

> [!IMPORTANT]
> Access tokens are not accepted as tool arguments. Save them in the plugin
> settings or DSH host environment so they do not enter model context or tool-call logs.

> [!WARNING]
> This release is for a single user or mutually trusted users. Hosts, tokens,
> `gh`/`glab` profiles, and the SSH agent are shared by the DSH instance.
> Workspace-local key paths are routing, not a multi-user security boundary.

## Tools

| Tool | Purpose | Writes state |
| --- | --- | --- |
| `auth_status` | Show GitHub CLI, GitLab CLI, SSH-agent, and public-key status. | No |
| `client_auth` | Log `gh` or `glab` in or out. | Yes; requests escalation if host access is not already granted |
| `ssh_key` | Generate, configure, list, or display the current workspace's Ed25519 deploy key. | Generation/configuration use workspace access; `ssh-add` requests host access |

Example requests:

```text
Check my GitHub, GitLab, and SSH authentication status.
Use the configured GH_TOKEN to sign in to GitHub.
Generate this workspace's deploy key and show its public key.
Configure this repository to use the existing workspace deploy key.
```

## Installation

### From source

1. Clone the plugin into a path visible to the DSH host:

   ```bash
   git clone https://github.com/Wisdoverse/dsh-git-auth-plugin.git \
     /path/to/local-plugins/dsh-git-auth
   ```

2. Add it to the target profile:

   ```bash
   dsh plugin --profile web add /path/to/local-plugins/dsh-git-auth
   ```

3. Restart the profile.

The package declares its DSH bundle in [`package.json`](package.json), and
[`cordis.patch.yml`](cordis.patch.yml) mounts the tool plugin in the host's
global tool layer.

## Configuration

Open **Settings → Plugins → Plugin configuration**, or edit the `git-auth`
section in the DSH settings document (normally `$DSH_HOME/settings.yaml`).

| Setting | Default | Accepted value |
| --- | --- | --- |
| `ghHost` | `github.com` | Bare GitHub hostname, optionally with a port |
| `glabHost` | `gitlab.com` | Bare GitLab hostname, optionally with a port |
| `commandTimeoutMs` | `60000` | Integer greater than or equal to `1` |
| `sshPath` | Empty | Direct child of `<workspace>/.ssh`; empty means `<workspace>/.ssh/id_ed25519` |
| `sshComment` | Empty | Default comment passed to `ssh-keygen` |
| `sshAddAgent` | `false` | Whether generated keys are loaded with `ssh-add` by default |

```yaml
git-auth:
  glabHost: gitlab.example.com
  commandTimeoutMs: 60000
  sshPath: id_ed25519
  sshComment: developer@example.com
  sshAddAgent: true
```

Settings are resolved at tool-call time, so host-side settings-file updates do
not require a plugin reinstall. DSH may restrict settings writes from remote
browsers; edit the host settings file if the UI is read-only.

`sshPath` is a shared default name resolved separately inside every session
workspace. `ssh_key generate` also writes that repository's local
`core.sshCommand`; use `action: configure` to bind an existing key. That command
uses `<workspace>/.ssh/known_hosts`, so it also works when the DSH process has no
`HOME`.

Key names ending in `.pub`, `.gitignore`, and `known_hosts` are reserved.
Public-key output validates a complete OpenSSH public key and omits its comment;
the on-disk comment is preserved, and showing a public-only file remains supported.

## Token handling

The plugin configuration card includes write-only **GitHub Token** and
**GitLab Token** fields. They store `GH_TOKEN` and `GITLAB_TOKEN` through the
DSH credentials service. The client requests only credential metadata, never
saved values; backend authorization, storage, and readback protection are owned
by the DSH credentials service.

The login tool resolves credential references in this order:

| Client | Precedence |
| --- | --- |
| `gh` | `GH_TOKEN` → `GITHUB_TOKEN` |
| `glab` | `GITLAB_TOKEN` → `GLAB_TOKEN` → `GITLAB_ACCESS_TOKEN` |

Existing deployment environment variables remain supported. When the DSH
credentials service is present, it owns environment/store precedence and write
permissions; otherwise the plugin reads the environment directly. Do not paste
tokens into chat or commit them to this repository.

Tokens are instance-global in the current DSH credential model and therefore
shared by all workspaces. Use a separate DSH instance for another user or trust
domain.

An environment token can be sent only to that client's configured host. To use
a different host, update `ghHost` or `glabHost` first, then restart DSH if the
host process also needs a new environment token.

## Security

This plugin manages host credentials, so its boundary is deliberately narrow:

- Tokens are resolved per login through the DSH credentials service (or host
  environment fallback) and passed to the CLI over stdin, not tool arguments or
  command strings. Host stdin logging and CLI output masking require separate
  deployment verification; status results include account and workspace metadata.
- Authentication hosts are validated as bare hostnames and encoded as single
  shell arguments.
- SSH key paths must resolve to direct children of the current workspace's
  `.ssh` directory; existing symlinks
  at the directory, private-key, or public-key path are rejected.
- Repository-local `core.sshCommand` pins Git to the workspace key with
  `IdentitiesOnly=yes` and a workspace-local `known_hosts`; a missing host is
  accepted on first use (`accept-new`) and later key changes are rejected.
- Before generating or configuring keys, the plugin appends an effective `*`
  rule to `.ssh/.gitignore`, preserving existing rules. This also protects keys
  created before `git init`. Already tracked `.ssh` files cause the operation to
  stop without changing the index. Untrack them explicitly and rotate any key
  previously published; ignore rules cannot protect against `git add -f` or
  remove secrets from history.
- Read operations and workspace key writes keep the calling session's sandbox
  boundary. Read-only sessions request workspace-write approval.
- Shared CLI credential mutations request DSH escalation when the session does
  not already have the required host access.
- Generated keys use Ed25519 and an empty passphrase for non-interactive agent
  use. Protect the DSH host and its credential directory accordingly.

## Development

### Commands

| Command | Purpose |
| --- | --- |
| `node test/compose.test.js` | Run command/token/path assertions and SSH disclosure/Git exclusion regressions; requires Node, Git, OpenSSH and Bash. |
| `node test/tools.test.js` | Exercise registered SSH tool handlers after installing peer dependencies. |
| `node --check lib/index.js` | Syntax-check the host plugin. |
| `node --check lib/client.js` | Syntax-check the settings client. |

### Project structure

| Path | Responsibility |
| --- | --- |
| `lib/index.js` | Tool registration, approvals, settings, and shell execution. |
| `lib/compose.js` | Pure host, token, shell-argument, and SSH-path helpers. |
| `lib/client.js` | Browser-side settings card. |
| `cordis.patch.yml` | DSH bundle mounting. |
| `test/compose.test.js` | Dependency-free regression checks. |

The running Web profile loads the plugin at startup. Restart it after changing
the source files.

## License

Released under the [MIT License](LICENSE).
