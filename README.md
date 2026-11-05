# vmage

让 Codex 和 Claude Code 用同一套配置调用 GPT Image，在当前项目里生成 PNG 图片。默认连接 OpenAI，支持兼容 Image API 的网关。运行环境需要 Node.js 22 或更高版本，只使用 Node 自带模块。

## 安装 Skill

在本仓库根目录执行对应命令。软链接让两个客户端直接使用这份源码，更新仓库后即可使用新版。

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

也可以将 `skills/vmage` **整个目录**复制到对应的 skills 目录。只对一个项目安装时，使用项目内的 `.agents/skills/`（Codex）或 `.claude/skills/`（Claude Code）。在目标项目开启新会话后，Codex 可用 `$vmage`，Claude Code 可用 `/vmage`。

## 生成第一张图

1. 在启动 Agent 的环境里配置 `OPENAI_API_KEY`。如使用 1Password，可用 `OPENAI_API_KEY='op://你的保险库/OpenAI/credential' op run -- codex` 启动。
2. 在 Agent 中输入「用 vmage 生成一张横版咖啡店封面，保存到 assets/cover.png」。
3. Agent 会返回生成的 PNG 路径。同名文件受到保护，再生成时请使用新文件名。

**项目配置优先于全局配置**，只覆盖填写的字段。项目文件为 `.vmage.json`，全局文件为 `~/.config/vmage/config.json`。配置示例、兼容网关和 Key 的用法见 [配置说明](skills/vmage/references/configuration.md)。

## 本地运行与测试

```sh
node skills/vmage/scripts/generate.mjs --show-config
node skills/vmage/scripts/generate.mjs --prompt "一张咖啡店插画" --out assets/cover.png
npm test
```

第一条命令只检查配置，第二条会向所选服务请求生图。测试使用临时目录和本地模拟网关。

## 目录

```text
skills/vmage/                 两个客户端共用的可安装目录
├── SKILL.md                  Agent 的触发说明和调用方式
├── scripts/
│   ├── generate.mjs          命令行入口
│   ├── config.mjs            查找项目、合并配置、匹配凭据
│   ├── images.mjs            调用 Image API、读取 PNG
│   └── output.mjs            管理输出文件、处理并发和重名
└── references/
    └── configuration.md      配置示例和优先级
tests/                        配置和命令行端到端测试
```
