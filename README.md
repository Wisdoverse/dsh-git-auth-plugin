<h1 align="center">dsh-git-auth</h1>

<p align="center">
  <strong>GitHub, GitLab, and SSH authentication tools for DeepSeek Harness</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/Wisdoverse/dsh-git-auth-plugin?style=flat-square"></a>
  <a href="package.json"><img alt="Top language" src="https://img.shields.io/github/languages/top/Wisdoverse/dsh-git-auth-plugin?style=flat-square"></a>
  <img alt="Token handling" src="https://img.shields.io/badge/tokens-environment%20only-2ea44f?style=flat-square">
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

Give DSH agents a small, approval-aware toolset for inspecting and managing
`gh`, `glab`, and SSH credentials on the host.

```text
Check authentication                 →  auth_status
Sign in with GH_TOKEN / GITLAB_TOKEN →  client_auth
Generate or inspect an SSH key       →  ssh_key
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
| Non-interactive login | Authenticates `gh` or `glab` with a token supplied by the DSH host environment. |
| SSH key management | Generates, lists, and displays Ed25519 keys directly under `~/.ssh`. |
| Approval-aware writes | Requests DSH approval before login, logout, key generation, or `ssh-add`. |
| Settings UI | Exposes hosts, timeout, key path, comment, and `ssh-add` defaults under **Settings → Plugins**. |

> [!IMPORTANT]
> Access tokens are not accepted as tool arguments. Put them in the DSH host
> environment so they do not enter the model context or tool-call log.

## Tools

| Tool | Purpose | Writes state |
| --- | --- | --- |
| `auth_status` | Show GitHub CLI, GitLab CLI, SSH-agent, and public-key status. | No |
| `client_auth` | Log `gh` or `glab` in or out. | Yes; approval required |
| `ssh_key` | Generate, list, or display an Ed25519 key. | Generation and `ssh-add` require approval |

Example requests:

```text
Check my GitHub, GitLab, and SSH authentication status.
Use the configured GH_TOKEN to sign in to GitHub.
Generate ~/.ssh/id_ed25519 and add it to ssh-agent.
Show the public key for ~/.ssh/id_ed25519.
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
| `sshPath` | Empty | Direct child of `~/.ssh`; empty means `~/.ssh/id_ed25519` |
| `sshComment` | Empty | Default comment passed to `ssh-keygen` |
| `sshAddAgent` | `false` | Whether generated keys are loaded with `ssh-add` by default |

```yaml
git-auth:
  glabHost: gitlab.example.com
  commandTimeoutMs: 60000
  sshPath: ~/.ssh/id_ed25519
  sshComment: developer@example.com
  sshAddAgent: true
```

Settings are resolved at tool-call time, so host-side settings-file updates do
not require a plugin reinstall. DSH may restrict settings writes from remote
browsers; edit the host settings file if the UI is read-only.

## Token handling

The plugin configuration card includes write-only **GitHub Token** and
**GitLab Token** fields. They store `GH_TOKEN` and `GITLAB_TOKEN` through the
DSH credentials service; saved values are never returned to the browser, so
the inputs stay blank and show only configured/source status.

The login tool resolves credential references in this order:

| Client | Precedence |
| --- | --- |
| `gh` | `GH_TOKEN` → `GITHUB_TOKEN` |
| `glab` | `GITLAB_TOKEN` → `GLAB_TOKEN` → `GITLAB_ACCESS_TOKEN` |

Existing deployment environment variables remain supported. A live environment
value is read-only and takes precedence over the DSH credential store. Do not
paste tokens into chat or commit them to this repository.

An environment token can be sent only to that client's configured host. To use
a different host, update `ghHost` or `glabHost` first, then restart DSH if the
host process also needs a new environment token.

## Security

This plugin manages host credentials, so its boundary is deliberately narrow:

- Tokens are resolved per login through the DSH credentials service and passed
  to the CLI over stdin; they never appear in settings responses, tool
  arguments, or command strings.
- Authentication hosts are validated as bare hostnames and encoded as single
  shell arguments.
- SSH key paths must resolve to direct children of `~/.ssh`; existing symlinks
  at the directory, private-key, or public-key path are rejected.
- Read operations keep the calling session's sandbox policy.
- Credential mutations request one-time DSH approval before running with the
  wider filesystem access required for host credential stores.
- Generated keys use Ed25519 and an empty passphrase for non-interactive agent
  use. Protect the DSH host and its credential directory accordingly.

## Development

### Commands

| Command | Purpose |
| --- | --- |
| `node test/compose.test.js` | Run dependency-free command, token, host, and path assertions. |
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
