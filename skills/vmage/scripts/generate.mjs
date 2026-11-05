#!/usr/bin/env node
import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import { loadConfig, resolveApiKey } from './config.mjs';
import { generateImage } from './images.mjs';
import { outputPath, writeGeneration } from './output.mjs';

const help = `vmage · 生成单张 PNG

  node generate.mjs [--prompt <描述>] [--out <文件.png>]
                    [--model <模型>] [--size <宽x高|auto>] [--quality <画质>]
  node generate.mjs --show-config

也可通过标准输入传入提示词。相对输出路径从调用项目根目录计算。
--show-config 显示生效配置，不读密钥、不调用 API。`;

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      'show-config': { type: 'boolean' },
      prompt: { type: 'string' },
      out: { type: 'string' },
      model: { type: 'string' },
      size: { type: 'string' },
      quality: { type: 'string' },
    },
  });
  const { prompt, out, help: showHelp, 'show-config': showConfig, ...overrides } = values;
  if (showHelp) {
    console.log(help);
    return;
  }
  const config = await loadConfig({ overrides });
  const { settings, projectRoot, projectConfig, globalConfig } = config;
  if (showConfig) {
    console.log(JSON.stringify({ projectRoot, globalConfig, projectConfig, ...settings }, null, 2));
    return;
  }
  const input = prompt ?? (process.stdin.isTTY ? '' : await text(process.stdin));
  if (!input.trim()) throw new Error('请用 --prompt 或标准输入传入生图描述。');
  const key = resolveApiKey(config);
  const path = outputPath(projectRoot, settings.outputDir, out);
  await writeGeneration(path, () => generateImage(settings, key, input.trim()));
  console.log(JSON.stringify({ path, mimeType: 'image/png', model: settings.model }));
}

main().catch(error => {
  console.error(`vmage: ${error.message}`);
  process.exitCode = 1;
});
