#!/usr/bin/env node
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import { saveCredential } from './credentials.mjs';
import { readSecret } from './secret-input.mjs';
import { globalConfigPath, loadConfig, readConfig, resolveCredential, validateSettings } from './config.mjs';

const help = `vmage · Agent 配置向导的离线执行工具

  node setup.mjs --check
  node setup.mjs --set-key
  node setup.mjs --scope global|project < settings.json

由 Agent 收集非敏感配置，以 JSON 经标准输入传入。只合并提供的字段。
用户在自己的终端运行 --set-key 隐藏输入，持久保存到用户级密钥文件。
环境变量优先。不接受命令行或管道密钥。不调用网络或生成图片。`;

function report(config) {
  let credentials;
  try {
    const { source } = resolveCredential(config);
    credentials = { status: 'ready', source };
  } catch (error) {
    credentials = { status: 'needs_credentials', message: error.message };
  }
  return {
    settings: config.settings,
    paths: {
      global: globalConfigPath(),
      credentials: config.credentialsPath,
      project: config.projectConfig ?? join(config.projectRoot, '.vmage.json'),
    },
    sources: { global: config.globalConfig, project: config.projectConfig },
    credentials,
    generationTested: false,
  };
}

async function save(scope, input) {
  const patch = validateSettings(input, '初始化配置');
  if (!Object.keys(patch).length) throw new Error('请至少提供一个配置字段。');
  const config = await loadConfig();
  const path = scope === 'global'
    ? globalConfigPath() : config.projectConfig ?? join(config.projectRoot, '.vmage.json');
  await mkdir(dirname(path), { recursive: true });
  // Serialize cooperating setup processes and publish only a complete validated file.
  const pending = `${path}.vmage-setup`;
  let file;
  let published = false;
  try {
    file = await open(pending, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('已有配置写入正在进行；确认进程退出后再清理 .vmage-setup 文件。');
    throw error;
  }
  try {
    const existing = await lstat(path).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (existing && !existing.isFile()) throw new Error('配置目标必须是普通文件，不能是符号链接或目录。');
    const previous = await readConfig(path) ?? {};
    const merged = { ...previous, ...patch };
    // A new service must not silently reuse the old service's credential selector.
    if (patch.baseUrl && !patch.apiKeyEnv && patch.baseUrl !== previous.baseUrl) {
      merged.apiKeyEnv = patch.baseUrl === 'https://api.openai.com/v1' ? 'OPENAI_API_KEY' : 'VMAGE_API_KEY';
    }
    const baseUrl = merged.baseUrl ?? config.settings.baseUrl;
    if (merged.apiKeyEnv === 'OPENAI_API_KEY' && baseUrl !== 'https://api.openai.com/v1') {
      throw new Error('OPENAI_API_KEY 只用于 OpenAI 官方地址。请为网关配置独立的 Key。');
    }
    await file.writeFile(JSON.stringify(merged, null, 2) + '\n');
    await file.sync();
    await file.close();
    await rename(pending, path);
    published = true;
    const result = report(await loadConfig());
    return {
      saved: true, path, scope, ...result,
      overriddenFields: Object.keys(merged).filter(field => merged[field] !== result.settings[field]),
    };
  } finally {
    await file.close();
    if (!published) await unlink(pending).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    'set-key': { type: 'boolean' }, check: { type: 'boolean' }, scope: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) return console.log(help);
  if ([values.check, values['set-key'], values.scope].filter(Boolean).length > 1) {
    throw new Error('--check、--set-key 与 --scope 不能同时使用。');
  }
  if (values['set-key']) {
    const config = await loadConfig();
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error('请在自己的交互式终端运行 --set-key；不接受管道或命令行密钥。');
    }
    console.log(`服务：${config.settings.baseUrl}\n变量名：${config.settings.apiKeyEnv}\n保存到：${config.credentialsPath}`);
    console.log('密钥以明文保存，文件访问权限仅限当前用户。');
    const key = await readSecret();
    saveCredential(config.credentialsPath, config.settings, key);
    console.log(JSON.stringify({ saved: true, ...report(config) }, null, 2));
    return;
  }
  if (values.check) return console.log(JSON.stringify(report(await loadConfig()), null, 2));
  if (!['global', 'project'].includes(values.scope)) throw new Error('请指定 --scope global 或 --scope project，或使用 --check。');
  if (process.stdin.isTTY) throw new Error('请通过标准输入传入非敏感配置 JSON。');
  let input;
  try { input = JSON.parse(await text(process.stdin)); }
  catch { throw new Error('标准输入需要有效的配置 JSON。'); }
  console.log(JSON.stringify(await save(values.scope, input), null, 2));
}

main().catch(error => {
  console.error(`vmage setup: ${error.message}`);
  process.exitCode = 1;
});
