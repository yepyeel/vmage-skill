# 生图配置

Codex 和 Claude Code 运行同一个脚本，共用以下配置。密钥优先从环境变量读取，没有时读取用户级密钥文件。

首次使用可直接对 Agent 说“帮我初始化 vmage 配置”，通过交互式提问完成。执行流程和环境变量输入方式见 [初始化向导](setup.md)。向导自动保存非敏感配置，并提供用户自行隐藏输入密钥的命令，不需要特定密码管理器。

## 项目覆盖全局

| 优先级（从高到低） | 来源 | 用途 |
| --- | --- | --- |
| 1 | 本次命令的 `--model`、`--size`、`--quality` | 只调整这一次请求 |
| 2 | 项目根目录的 `.vmage.json` | 当前项目的偏好 |
| 3 | `~/.config/vmage/config.json` | 两个 Agent 和各项目共用的偏好 |
| 4 | `VMAGE_BASE_URL`、`VMAGE_MODEL` | 当前进程的默认服务和模型 |
| 5 | 内置默认值 | OpenAI 官方服务 |

逐字段覆盖。`XDG_CONFIG_HOME` 为绝对路径时，全局文件位于该目录的 `vmage/config.json`。从当前工作目录向上查找最近的 `.vmage.json`，查到 Git 根目录（含 worktree）为止，也会在个人主目录前停止。只读取最近的一份项目配置。没有项目文件时，以 Git 根目录或启动目录作为输出的基准。

这份全局配置把方图设为默认，并将图片保存到各自项目的 `assets/generated` 目录。

```json
{
  "model": "gpt-image-2.5-flare",
  "size": "1024x1024",
  "quality": "medium",
  "outputDir": "assets/generated"
}
```

需要横版封面的项目可以在 `.vmage.json` 中覆盖尺寸和画质。

```json
{
  "size": "1536x1024",
  "quality": "high"
}
```

这个项目会用横版尺寸和高画质，模型和输出目录沿用全局设置。其他项目仍按全局设置生成方图。

## 可配置的字段

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `baseUrl` | `https://api.openai.com/v1` | API 根地址，保留网关所需的路径前缀。脚本追加 `/images/generations`。 |
| `apiKeyEnv` | 官方用 `OPENAI_API_KEY`，网关用 `VMAGE_API_KEY` | 存放 Key 的环境变量名，使用以 `_API_KEY` 结尾的大写名称。 |
| `model` | `gpt-image-2.5-flare` | 官方模型名或网关提供的模型名。 |
| `size` | 服务端默认 | `auto` 或 `宽x高`，如 `1536x1024`。具体可用尺寸由模型决定。 |
| `quality` | 服务端默认 | `auto`、`low`、`medium`、`high`、`xhigh` 或 `max`，依模型支持选择。 |
| `outputDir` | `output/vmage` | 自动命名图片的目录。相对路径从项目根目录计算。`--out` 可直接指定输出文件。 |

## 使用兼容网关

**长期使用同一网关**时，把地址和变量名写进全局配置，再在启动 Agent 的环境里注入 `STUDIO_API_KEY`。两个客户端共用这份设置。

```json
{
  "baseUrl": "https://images.example.com/openai/v1",
  "apiKeyEnv": "STUDIO_API_KEY",
  "model": "your-gateway-image-model"
}
```

**只给某个项目换网关**时，可将上面这段写进该项目的 `.vmage.json`，并在自己的启动环境中将 `STUDIO_BASE_URL` 设为同一个根地址。配套的 `*_BASE_URL` 将 Key 绑定到指定地址。下面的命令由用户在自己的 Bash/Zsh 终端运行，通过隐藏输入提供密钥：

```sh
export STUDIO_BASE_URL='https://images.example.com/openai/v1'
printf 'API Key（输入不回显）: '
read -rs STUDIO_API_KEY
printf '\n'
export STUDIO_API_KEY
claude
```

启动 Codex 时把最后的 `claude` 换成 `codex`。也可由自己的终端、IDE 或桌面启动环境提供这些变量。Skill 的配置文件只保存环境变量名，不自动读取 `.env`。已经运行的 Agent 不会收到另一个终端后来设置的变量，需要从配置好的环境重新启动。

**只用环境变量**时，可设置 `VMAGE_BASE_URL`、`VMAGE_API_KEY` 和可选的 `VMAGE_MODEL`。它们适合临时切换服务。

密钥绑定按完整 API 根地址匹配（含端口、路径前缀，忽略末尾的斜杠）。项目仅调整模型或尺寸会继续使用原 Key。项目换地址时，需要匹配新地址的凭据。绑定可来自个人全局配置或对应的 `*_BASE_URL` 环境变量。两处都有绑定时，以环境变量声明的地址为准。`OPENAI_API_KEY` 专用于官方根地址。

## 检查生效配置

在目标项目运行 `node "/path/to/vmage/scripts/generate.mjs" --show-config`，即可查看命中的全局文件、项目文件、输出根目录、服务地址、模型和密钥变量名。这个命令不需要 Key，也不会发起请求。

网关须接受 Bearer 鉴权和 JSON 格式的 `POST /images/generations`，并在 `data[0].b64_json` 返回 PNG。收到重定向时，请填写最终 API 根地址。详见 [OpenAI 生图接口](https://developers.openai.com/api/reference/resources/images/methods/generate)。

## 持久保存密钥

在目标项目目录运行 `node "/path/to/vmage/scripts/setup.mjs" --set-key`，在自己的终端隐藏输入密钥。支持 macOS、Linux 和 Windows，无需在 shell 启动文件保存密钥。

密钥文件固定为全局配置旁的 `credentials.json`，项目配置不能指定密钥文件路径。记录按完整 API 根地址和密钥变量名匹配；换网关不会沿用其他地址的密钥，多个服务可以共存。环境变量非空时优先使用环境变量，并继续检查其地址绑定；绑定错误不会退回文件。环境变量为空时，文件内记录的地址本身提供绑定，不要求额外设置 `*_BASE_URL`。

密钥文件是明文，使用当前用户专属访问权限。路径、Windows ACL 和交互流程见 [初始化向导](setup.md)。`--check` 只输出密钥是否就绪和来源，不输出密钥；`--show-config` 不读取密钥文件。用户设置好文件后，后续生图调用立即生效。
