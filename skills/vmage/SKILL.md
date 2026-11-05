---
name: vmage
description: Generate a PNG using a configured GPT Image API or compatible gateway, and initialize vmage configuration through conversation. 用于文生图、生成封面或插画、保存图片，以及交互式初始化或修改 vmage 配置。仅编写或润色提示词时只提供文字。
---

# vmage

当用户需要一张实际的图片时，使用本 Skill 随附的 Node.js 22+ 脚本。它读取用户为当前项目配置的生图服务，每次请求生成一张 PNG。

## 初始化配置

用户要求初始化、配置或更换 vmage 服务时，读取 [初始化向导](references/setup.md)，通过宿主的交互式提问收集信息，再调用 `scripts/setup.mjs`。没有交互式工具时用普通对话。不要求用户手写 JSON，不在聊天中索取真实 API Key。

首次生成前可运行 `node "/path/to/vmage/scripts/setup.mjs" --check`。若缺少配置或密钥，按向导补齐缺失项；已有环境配置且 `credentials.status` 为 `ready` 时可直接生成，无须强迫保存文件。只检查或初始化时不发起生图请求。

## 生成图片

1. 从用户请求中提取主体、用途、画面要求和需要原样出现的文字。用户给出文件名、尺寸或画质时一并传入。只给出横版或竖版要求时，可分别使用 `1536x1024` 或 `1024x1536`。其余选项交给项目配置。
2. 找到**本文件所在目录**下的 `scripts/generate.mjs`，用脚本的绝对路径执行，**工作目录保持在用户的项目中**。下面的路径是示意，调用时替换为实际安装路径。

   ```sh
   node "/path/to/vmage/scripts/generate.mjs" --prompt "咖啡店封面，窗边的白瓷杯，晨光" --size 1536x1024 --out "assets/cover.png"
   ```

   复杂或多行提示词优先通过标准输入传递。已有提示词文件时可用 `node "/path/to/vmage/scripts/generate.mjs" < prompt.txt`。省略 `--out` 会在配置的输出目录生成唯一文件名。
3. 成功时读取标准输出 JSON 的 `path`，用宿主支持的预览方式展示图片，或给出可打开的文件链接。改一版时使用新文件名。
4. 失败时根据脚本的错误说明处理。请求超时或中断后先报告结果待确认，由用户决定是否再次生成。只要求写提示词、解释配置或检查安装时，无须发起生图请求。

配置排查可运行 `node "/path/to/vmage/scripts/generate.mjs" --show-config`。全局和项目文件的位置、网关 Key 的绑定方式见 [配置说明](references/configuration.md)。API Key 优先从环境变量读取，否则读取地址匹配的用户级密钥文件。设置密钥请按初始化向导让用户在自己的终端运行 `setup.mjs --set-key`，不要在聊天中接收密钥。
