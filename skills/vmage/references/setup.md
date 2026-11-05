# Agent 内初始化

所有脚本使用技能目录下的绝对路径，工作目录保持在用户项目中。向导由 Agent 提问，脚本只负责离线检查、校验和保存；不依赖特定 Agent、密码管理器或浏览器。

## 1. 读取当前状态

```sh
node "/path/to/vmage/scripts/setup.mjs" --check
```

读取 `settings`、`sources`、`paths` 和 `credentials`。`paths` 表示实际保存位置，支持 `XDG_CONFIG_HOME`。检查不写文件、不访问网络、不输出密钥。配置文件损坏时先说明具体错误，不用默认值覆盖它。

## 2. 收集缺少的信息

优先使用宿主的选择题或输入框，不支持时用普通对话。沿用用户已提供的信息和现有设置，避免重复询问。

- 服务：OpenAI 官方 / 兼容网关。官方网关地址为 `https://api.openai.com/v1`；兼容网关需要完整 API 根地址，不含 `/images/generations`，不得包含密钥。
- 模型：采用用户指定或已有的名称；首次配置让用户填写服务商提供的准确名称，不宣称内置默认模型一定可用。
- 范围：全局（推荐，所有项目共用）/ 当前项目。说明检查结果中的实际保存路径；项目配置优先于全局。
- 密钥环境变量名：官方默认 `OPENAI_API_KEY`，网关默认 `VMAGE_API_KEY`，已有自定义名称时沿用。只收集变量名，不收集变量值。

尺寸、画质和输出目录保留现有设置或默认值，仅在用户要求时调整。换服务时同时明确密钥变量名，不沿用另一服务的变量。

## 3. 保存非敏感配置

收集完用户选择即可保存，不重复请求确认。将选择转换为 JSON，通过标准输入传给脚本。示例：

```sh
node "/path/to/vmage/scripts/setup.mjs" --scope global <<'JSON'
{
  "baseUrl": "https://images.example.com/v1",
  "apiKeyEnv": "VMAGE_API_KEY",
  "model": "provider-model-name"
}
JSON
```

仅写入用户选定的字段；脚本会合并已有文件，不删除其他设置。`--scope project` 写最近的项目配置，若不存在则写 Git 根目录，非 Git 项目写当前目录。不要通过修改工作目录意外写入技能安装目录。传参时注意宿主的 shell 引用，JSON 不等于 shell 转义。

结果中 `saved: true` 表示文件已保存，`overriddenFields` 非空表示这些全局设置被当前项目覆盖。说明覆盖情况，不擅自改动另一个范围的文件。

## 4. 设置密钥

向用户提供三种选择：用户级文件持久保存（推荐桌面用户）/ 使用已有环境变量 / 稍后设置。环境变量优先，空值视为未设置。只询问保存方式，不在聊天中索取真实密钥。

### 用户级文件持久保存

先保存非敏感配置，再给用户以下命令，路径替换为实际技能安装路径。用户在自己的终端运行，Agent 不代为输入或接收密钥：

```sh
node "/path/to/vmage/scripts/setup.mjs" --set-key
```

同一条 Node 命令适用于 macOS/Linux 的终端和 Windows PowerShell/CMD，不依赖 shell 的 `read`、`export` 或密码管理器。命令必须在目标项目目录运行，以使用与 Agent 相同的有效服务配置。

脚本显示当前服务地址、变量名和保存路径，用户核对后输入密钥（不回显），回车保存，Ctrl+C 取消。密钥不能通过命令参数或管道传入。已有相同地址与变量名的密钥会被替换，其他记录保留。

文件路径是全局配置旁的 `credentials.json`，以 `--check` 返回的 `paths.credentials` 为准：

- macOS/Linux：默认 `~/.config/vmage/credentials.json`。
- Windows：默认 `%USERPROFILE%\.config\vmage\credentials.json`。
- 设置了绝对路径 `XDG_CONFIG_HOME` 时：其下的 `vmage/credentials.json`，与已有配置路径规则一致。

文件是明文存储，不是加密钥匙串。macOS/Linux 使用当前用户所有的 `0600` 文件；Windows 通过系统自带 PowerShell 设置仅当前用户访问的 ACL，无法设置或验证权限时停止，不静默保存为宽松权限。不要读取、展示或提交密钥文件，也不要将 `XDG_CONFIG_HOME` 指向项目目录。

用户输入完成后，Agent 运行 `--check`。同一用户、相同配置目录下的新生图调用会直接读取文件，不需要重启 Agent。如果终端和 Agent 使用了不同的 `XDG_CONFIG_HOME`，先对齐路径。`credentials.source` 为 `environment` 表示环境变量覆盖了文件，保存新密钥不会自动清除旧环境变量。

### 使用环境变量

官方接口使用 `OPENAI_API_KEY`。网关使用对应变量名，并通过全局配置或配套的 `*_BASE_URL` 绑定服务地址。例如 `STUDIO_API_KEY` 对应 `STUDIO_BASE_URL`。不要读取或打印全部环境变量。

变量必须由启动 Agent 的环境提供；在另一个终端设置变量不会影响已经运行的 Agent。此模式适用于终端、IDE 和 CI 自行注入密钥，不自动读取 `.env` 或修改 shell 配置。

### 解释检查结果

`credentials.status: ready` 表示可读取密钥且地址匹配；`source` 标明 `environment` 或 `file`。这不证明密钥有效、模型可用或账号有额度。

`needs_credentials` 时，根据 `message` 处理缺失、绑定或权限问题。不因文件可用而绕过已有环境变量的错误绑定，也不覆盖损坏文件。用户选择稍后设置时，结束为“配置已保存，待设置密钥”，不要反复提问或声称已可生图。

## 5. 可选生图验证

仅初始化任务不自动测试生图。说明离线检查结果，用户要求测试后再调用 `generate.mjs`，测试文件可放系统临时目录。若初始化是原生图任务的前置步骤且环境已经就绪，继续原任务，无须再次授权。超时或中断不自动重试。
