# dsh-git-auth

一个 DSH **宿主工具插件**(bundle),给 agent 提供三个工具,用于管理 **glab / gh 授权** 和 **SSH key**。

## 提供的工具

| 工具 | 作用 |
|---|---|
| `auth_status` | 只读状态:gh / glab 是否已授权(以及以哪个账号)、SSH agent 里有哪些 key、`~/.ssh` 下有哪些公钥。 |
| `client_auth` | 非交互登录/登出 gh 或 glab。token 只从环境变量读取并走 stdin，不进入工具参数或输出。 |
| `ssh_key` | 生成 / 列出 / 显示 ed25519 SSH key,生成后可选 `ssh-add` 并打印公钥供粘贴。 |

## 工作原理

按 DSH bundle 约定,插件是一个声明了 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的 npm 包。
`cordis.patch.yml` 把工具插件 **insert 进宿主组装**,因此它会注册进 tools 注册表的 **global 层**——任何 agent 经 scope 链(agent → preset → global)都能看到,与运行哪个 preset 无关。

所有命令都通过宿主 `ctx.shell` 执行,继承当前会话的沙箱策略和取消语义。读取状态沿用当前策略;登录、登出、生成 key 和 `ssh-add` 在执行前通过 DSH 原生 approval 请求一次性权限提升。SSH key 路径被限制为 `~/.ssh` 的直接子文件。

## 安装

在目标 profile 下用 `dsh plugin add` 安装本插件目录(记得把路径改成你的实际路径):

```bash
cd <你的 profile 目录>   # 或直接跳到下一步
dsh plugin add /data/dsh/home/dsh-git-auth
```

安装会对齐 profile 的 bundle 列表并重启后生效。若你要在 **Web** 界面使用,重启用到的 profile。

## 使用(给 agent 的自然语言)

- 检查状态:`auth_status`
- gh 登录(用现存环境变量 token):`client_auth(client: "gh")`
- gh 登出:`client_auth(client: "gh", logout: true)`
- 生成 SSH key 并加入 agent:`ssh_key(action: "generate", comment: "you@example.com", add_agent: true)`
- 看某个公钥:`ssh_key(action: "show", path: "~/.ssh/id_ed25519")`

登录/登出和 SSH key 写操作会先弹出用户批准;拒绝批准时不会执行命令。

## 设置

插件注册了一个用户可编辑的 settings 命名空间 `git-auth`,可配置项:

| 字段 | 默认 | 作用 |
|---|---|---|
| `ghHost` | `github.com` | gh 登录默认主机 |
| `glabHost` | `gitlab.com` | glab 登录默认主机 |
| `commandTimeoutMs` | `60000` | 单个子命令超时(ms) |
| `sshPath` | ``(空)→ `~/.ssh/id_ed25519` | 生成/显示 key 的默认路径 |
| `sshComment` | ``(空) | 生成 key 的默认 comment |
| `sshAddAgent` | `false` | 默认是否把新 key 加入 ssh-agent |

生效顺序:schema 默认值 < 组装 entry config < 用户设置(即下面的编辑)。所有字段都在工具调用时**实时读取**,改完即生效,无需重启。

**Settings 界面**:`lib/client.js`(浏览器半包,声明于 `package.json` 的 `dsh.client`)在 **Settings > Plugins** 里认领 `git-auth` 卡片,可直接在 Web 界面编辑上述全部字段、保存或重置为默认,写入的就是同一份用户设置层。

**在哪里编辑**
- 用户设置文档:base 层用 `dsh-settings-file` 提供,路径为 `$DSH_HOME/settings.yaml`(默认 `~/.dsh/settings.yaml`),热加载。加一段即可:

```yaml
# ~/.dsh/settings.yaml
git-auth:
  glabHost: gitlab.example.com
  sshAddAgent: true
  sshComment: you@example.com
```

## Token 约定(重要)

登录时 token 只从环境变量读取:

- gh:`GH_TOKEN` → `GITHUB_TOKEN`
- glab:`GITLAB_TOKEN` → `GLAB_TOKEN` → `GITLAB_ACCESS_TOKEN`

**推荐把 token 放进环境变量或 `.env`,而不是写进对话**——这样密钥只出现在进程环境里,不穿越模型上下文。

环境变量 token 只允许发送到对应客户端在插件设置中配置的主机。登录其他主机前必须先修改对应主机设置；主机名会被校验并作为单个 shell 参数编码。

## 自检

```bash
node test/compose.test.js   # 纯逻辑断言,无框架
```

## 已刻意跳过

- 交互式登录(浏览器/device flow):需要 TTY,在多数会话跑不通;token 非交互覆盖了同一目标。
- 把 git 远端从 HTTPS 改成 SSH:不是授权管理的主体,需要时用 `git remote set-url` 即可。
- per-preset 选择性挂载:global 层注册对所有 agent 生效;若想只对某个 preset 开,把 `cordis.patch.yml` 的 `insert` 行挪进对应 preset 的 `agent.cordis.yml` 即可。
