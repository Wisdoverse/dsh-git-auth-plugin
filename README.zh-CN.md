<h1 align="center">dsh-git-auth</h1>

<p align="center">
  <strong>面向 DeepSeek Harness 的 GitHub、GitLab 与 SSH 授权工具</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="许可证" src="https://img.shields.io/github/license/Wisdoverse/dsh-git-auth-plugin?style=flat-square"></a>
  <a href="package.json"><img alt="主要语言" src="https://img.shields.io/github/languages/top/Wisdoverse/dsh-git-auth-plugin?style=flat-square"></a>
  <img alt="Token 处理" src="https://img.shields.io/badge/token-仅限环境变量-2ea44f?style=flat-square">
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>简体中文</strong>
</p>

为 DSH agent 提供一组小而明确、受审批保护的宿主工具，用于检查和管理
`gh`、`glab` 与 SSH 凭据。

```text
检查授权状态                         →  auth_status
使用 GH_TOKEN / GITLAB_TOKEN 登录    →  client_auth
生成或查看 SSH key                   →  ssh_key
```

## 目录

- [功能特性](#功能特性)
- [工具](#工具)
- [安装](#安装)
- [配置](#配置)
- [Token 处理](#token-处理)
- [安全设计](#安全设计)
- [开发](#开发)
- [许可证](#许可证)

## 功能特性

| 特性 | 说明 |
| --- | --- |
| 统一状态检查 | 一次查看 `gh`、`glab`、SSH agent 和本地公钥状态。 |
| 非交互登录 | 使用 DSH 宿主环境中的 token 登录 `gh` 或 `glab`。 |
| SSH key 管理 | 在 `~/.ssh` 的直接子路径中生成、列出和显示 Ed25519 key。 |
| 写操作审批 | 登录、登出、生成 key 或执行 `ssh-add` 前请求 DSH 审批。 |
| 设置界面 | 在 **设置 → 插件** 中配置主机、超时、key 路径、注释和 `ssh-add` 默认值。 |

> [!IMPORTANT]
> 工具不接受 token 参数。请把 token 注入 DSH 宿主环境，避免其进入模型上下文或工具调用日志。

## 工具

| 工具 | 用途 | 是否写入状态 |
| --- | --- | --- |
| `auth_status` | 显示 GitHub CLI、GitLab CLI、SSH agent 和公钥状态。 | 否 |
| `client_auth` | 登录或登出 `gh` / `glab`。 | 是；需要审批 |
| `ssh_key` | 生成、列出或显示 Ed25519 key。 | 生成和 `ssh-add` 需要审批 |

可以直接对 agent 这样说：

```text
检查我的 GitHub、GitLab 和 SSH 授权状态。
使用环境中配置的 GH_TOKEN 登录 GitHub。
生成 ~/.ssh/id_ed25519 并加入 ssh-agent。
显示 ~/.ssh/id_ed25519 的公钥。
```

## 安装

### 从源码安装

1. 将插件克隆到 DSH 宿主可访问的位置：

   ```bash
   git clone https://github.com/Wisdoverse/dsh-git-auth-plugin.git \
     /path/to/local-plugins/dsh-git-auth
   ```

2. 添加到目标 profile：

   ```bash
   dsh plugin --profile web add /path/to/local-plugins/dsh-git-auth
   ```

3. 重启该 profile。

[`package.json`](package.json) 声明 DSH bundle，
[`cordis.patch.yml`](cordis.patch.yml) 将工具插件挂载到宿主的全局工具层。

## 配置

打开 **设置 → 插件 → 插件配置**，或编辑 DSH 设置文档（通常是
`$DSH_HOME/settings.yaml`）中的 `git-auth` 段。

| 设置项 | 默认值 | 可接受值 |
| --- | --- | --- |
| `ghHost` | `github.com` | GitHub 主机名，可带端口，不含协议和路径 |
| `glabHost` | `gitlab.com` | GitLab 主机名，可带端口，不含协议和路径 |
| `commandTimeoutMs` | `60000` | 大于等于 `1` 的整数 |
| `sshPath` | 留空 | `~/.ssh` 的直接子路径；留空表示 `~/.ssh/id_ed25519` |
| `sshComment` | 留空 | 传给 `ssh-keygen` 的默认注释 |
| `sshAddAgent` | `false` | 是否默认通过 `ssh-add` 加载新生成的 key |

```yaml
git-auth:
  glabHost: gitlab.example.com
  commandTimeoutMs: 60000
  sshPath: ~/.ssh/id_ed25519
  sshComment: developer@example.com
  sshAddAgent: true
```

设置会在每次工具调用时重新解析，因此修改宿主设置文件无需重新安装插件。DSH
可能限制远程浏览器写入设置；若界面只读，请直接编辑宿主设置文件。

## Token 处理

插件配置卡片包含只写的 **GitHub Token** 与 **GitLab Token** 字段。它们通过
DSH 凭据服务分别保存为 `GH_TOKEN` 和 `GITLAB_TOKEN`；已保存的值绝不会返回
浏览器，因此输入框始终为空，只显示是否已配置及来源。

登录工具按以下顺序解析凭据引用：

| 客户端 | 优先级 |
| --- | --- |
| `gh` | `GH_TOKEN` → `GITHUB_TOKEN` |
| `glab` | `GITLAB_TOKEN` → `GLAB_TOKEN` → `GITLAB_ACCESS_TOKEN` |

原有部署环境变量仍然支持。进程环境中的值只读，并优先于 DSH 凭据存储。不要把
token 粘贴到对话中，也不要提交到本仓库。

环境变量 token 只能发送到对应客户端已配置的主机。若要登录其他主机，请先修改
`ghHost` 或 `glabHost`；如果宿主进程也需要新的环境变量 token，再重启 DSH。

## 安全设计

本插件直接管理宿主凭据，因此刻意保持较窄的权限边界：

- Token 在每次登录时通过 DSH 凭据服务解析并经 stdin 交给 CLI，不进入设置响应、
  工具参数或命令字符串。
- 授权主机必须是合法的裸主机名，并编码为单个 shell 参数。
- SSH key 必须位于 `~/.ssh` 的直接子路径；目录、私钥或公钥路径上的已有符号链接会被拒绝。
- 只读操作沿用当前会话的沙箱策略。
- 凭据写操作先请求一次 DSH 审批，再取得访问宿主凭据目录所需的更宽文件权限。
- 新 key 使用 Ed25519 和空密码，以便 agent 非交互使用；请妥善保护 DSH 宿主及其凭据目录。

## 开发

### 常用命令

| 命令 | 用途 |
| --- | --- |
| `node test/compose.test.js` | 运行无依赖的命令、token、主机和路径断言。 |
| `node --check lib/index.js` | 检查宿主插件语法。 |
| `node --check lib/client.js` | 检查设置客户端语法。 |

### 项目结构

| 路径 | 职责 |
| --- | --- |
| `lib/index.js` | 工具注册、审批、设置和 shell 执行。 |
| `lib/compose.js` | 主机、token、shell 参数和 SSH 路径纯辅助函数。 |
| `lib/client.js` | 浏览器端设置卡片。 |
| `cordis.patch.yml` | DSH bundle 挂载。 |
| `test/compose.test.js` | 无依赖回归检查。 |

Web profile 会在启动时加载插件。修改源码后请重启对应 profile。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
