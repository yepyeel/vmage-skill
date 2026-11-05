# vmage

让 Codex 和 Claude Code 用同一套配置调用 GPT Image，在当前项目里生成 PNG 图片。默认连接 OpenAI，支持兼容 Image API 的网关。运行环境需要 Node.js 22 或更高版本，只使用 Node 自带模块。

## 安装（Installation）

把这句话发给能安装 Skill 的 Agent：

```text
请在当前项目为 Codex 和 Claude Code 安装 vmage，运行 npx skills add yepyeel/vmage-skill --skill vmage -a codex claude-code -y
```

也可以在目标项目的终端直接运行：

```sh
npx skills add yepyeel/vmage-skill --skill vmage -a codex claude-code -y
```

这条命令安装到当前项目。要让当前用户的所有项目都能使用，在命令末尾加上 `-g`。

## 用法（Usage）

首次使用可以直接在 Agent 中输入：

```text
帮我初始化 vmage 配置
```

Agent 会通过交互式提问收集服务、模型和配置范围，自动保存配置。API Key 可通过用户级文件持久保存，也可由环境变量提供（优先）。不需要特定密码管理器，也不要把真实密钥发到聊天里。向导会引导你在自己的终端隐藏输入一次，桌面 Agent 随后即可读取，不需要重启。配置和检查本身不调用生图 API。

已有配置时，在目标项目目录运行以下命令，按提示输入密钥即可持久保存（macOS、Linux、Windows 通用）：

```sh
node "/实际安装路径/vmage/scripts/setup.mjs" --set-key
```

密钥以明文保存在用户配置目录的 `credentials.json`，文件访问权限仅限当前用户。环境变量仍然优先；官方接口默认使用 `OPENAI_API_KEY`。路径及权限说明见 [初始化向导](skills/vmage/references/setup.md)。

**在 Codex 中输入**

```text
$vmage 生成一张横版咖啡店封面，保存到 assets/cover.png
```

**在 Claude Code 中输入**

```text
/vmage 生成一张 1024x1024 的橘猫水彩插画，保存到 assets/cat.png
```

Agent 会返回 PNG 的文件路径。省略文件名时，图片默认保存在项目的 `output/vmage/` 目录，并自动取一个新名字。指定的文件已存在时，请换个文件名再生成。

**项目配置优先于全局配置**，只覆盖填写的字段。项目文件为 `.vmage.json`，全局文件为 `~/.config/vmage/config.json`。切换模型、网关或默认输出目录的方法见 [配置说明](skills/vmage/references/configuration.md)。

## 从本地源码安装

开发这个 Skill 时，可以在本仓库根目录执行对应命令，让客户端通过软链接直接使用本地源码。

**Codex**

```sh
mkdir -p "$HOME/.agents/skills"
ln -s "$PWD/skills/vmage" "$HOME/.agents/skills/"
```

**Claude Code**

```sh
mkdir -p "$HOME/.claude/skills"
ln -s "$PWD/skills/vmage" "$HOME/.claude/skills/"
```

也可以将 `skills/vmage` **整个目录**复制到对应的 skills 目录。只对一个项目安装时，使用项目内的 `.agents/skills/`（Codex）或 `.claude/skills/`（Claude Code）。

## 本地运行与测试

```sh
node skills/vmage/scripts/generate.mjs --show-config
node skills/vmage/scripts/setup.mjs --check
node skills/vmage/scripts/generate.mjs --prompt "一张咖啡店插画" --out assets/cover.png
npm test
```

`--show-config` 显示配置，`--check` 另外检查密钥是否可读取，两者均不联网。带 `--prompt` 的命令会请求生图。测试使用临时目录和本地模拟网关。

## 目录

```text
skills/vmage/                 两个客户端共用的可安装目录
├── SKILL.md                  Agent 的触发说明和调用方式
├── scripts/
│   ├── generate.mjs          命令行入口
│   ├── setup.mjs             初始化配置、密钥设置与离线检查
│   ├── credentials.mjs       用户级密钥文件与访问权限
│   ├── secret-input.mjs      跨平台终端隐藏输入
│   ├── config.mjs            查找项目、合并配置、匹配凭据
│   ├── images.mjs            调用 Image API、读取 PNG
│   └── output.mjs            管理输出文件、处理并发和重名
└── references/
    ├── configuration.md      配置示例和优先级
    └── setup.md              Agent 交互式初始化流程
tests/                        配置和命令行端到端测试
```
