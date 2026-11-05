import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const OFFICIAL_URL = 'https://api.openai.com/v1';
const DEFAULTS = {
  model: 'gpt-image-2.5-flare',
  outputDir: 'output/vmage',
};
const fields = new Set(['baseUrl', 'apiKeyEnv', 'model', 'size', 'quality', 'outputDir']);
const qualities = new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('baseUrl 需要是完整的 API 根地址，例如 https://api.openai.com/v1。');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.href.includes('?') || url.href.includes('#')) {
    throw new Error('baseUrl 仅接受 HTTP(S) 根地址，不能包含账号、密码、查询参数或片段。');
  }
  const base = url.href.replace(/\/+$/, '');
  if (base.endsWith('/images/generations')) {
    throw new Error('baseUrl 请填写 API 根地址，脚本会自动追加 /images/generations。');
  }
  return base;
}

function defaultKeyEnv(baseUrl) {
  return baseUrl === OFFICIAL_URL ? 'OPENAI_API_KEY' : 'VMAGE_API_KEY';
}

function validateSettings(input, source) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${source} 需要是 JSON 对象。`);
  }
  const result = {};
  for (const [field, value] of Object.entries(input)) {
    if (field === 'apiKey') throw new Error(`${source} 请用 apiKeyEnv 指定保存密钥的环境变量名。`);
    if (!fields.has(field)) throw new Error(`${source} 含有未知配置项 ${field}。`);
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${source} 的 ${field} 需要是非空字符串。`);
    }
    result[field] = value.trim();
  }
  if (result.baseUrl) result.baseUrl = normalizeBaseUrl(result.baseUrl);
  if (result.apiKeyEnv && !/^[A-Z][A-Z0-9_]*_API_KEY$/.test(result.apiKeyEnv)) {
    throw new Error(`${source} 的 apiKeyEnv 请使用以 _API_KEY 结尾的大写环境变量名。`);
  }
  if (result.size && result.size !== 'auto' && !/^[1-9]\d*x[1-9]\d*$/.test(result.size)) {
    throw new Error(`${source} 的 size 请使用 auto 或 宽x高，例如 1536x1024。`);
  }
  if (result.quality && !qualities.has(result.quality)) {
    throw new Error(`${source} 的 quality 可选 ${[...qualities].join('、')}。`);
  }
  return result;
}

async function readConfig(path) {
  let contents;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let data;
  try {
    data = JSON.parse(contents.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error(`${path} 包含无效的 JSON，请检查语法。`);
  }
  return validateSettings(data, path);
}

async function findProject(cwd, home) {
  for (let dir = cwd; dir !== home; dir = dirname(dir)) {
    const path = join(dir, '.vmage.json');
    const settings = await readConfig(path);
    if (settings) return { root: dir, path, settings };
    // A worktree's .git is a file. Either form ends this project's search.
    if (existsSync(join(dir, '.git'))) return { root: dir };
    if (dirname(dir) === dir) break;
  }
  return { root: cwd };
}

export async function loadConfig({
  cwd = process.cwd(), home = homedir(), env = process.env, overrides = {},
} = {}) {
  // A relative XDG path would let the working project supply trusted global credentials.
  const configHome = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME : join(home, '.config');
  const globalPath = join(configHome, 'vmage', 'config.json');
  const [global, project] = await Promise.all([
    readConfig(globalPath), findProject(resolve(cwd), resolve(home)),
  ]);
  const envBase = env.VMAGE_BASE_URL ? normalizeBaseUrl(env.VMAGE_BASE_URL) : OFFICIAL_URL;
  const settings = { ...DEFAULTS, baseUrl: envBase };
  if (env.VMAGE_MODEL?.trim()) settings.model = env.VMAGE_MODEL.trim();
  Object.assign(settings, global, project.settings, validateSettings(overrides, '命令行'));

  // Only inherit a key selector across layers when the destination matches.
  const globalBase = global?.baseUrl ?? envBase;
  const globalKey = globalBase === settings.baseUrl ? global?.apiKeyEnv : undefined;
  settings.apiKeyEnv = project.settings?.apiKeyEnv ?? globalKey ?? defaultKeyEnv(settings.baseUrl);

  return {
    settings,
    projectRoot: project.root,
    projectConfig: project.path ?? null,
    globalConfig: global ? globalPath : null,
    // Only a user-global binding or an environment binding can authorize a destination.
    globalBinding: global?.baseUrl
      ? { baseUrl: global.baseUrl, keyEnv: global.apiKeyEnv ?? defaultKeyEnv(global.baseUrl) } : null,
  };
}

export function resolveApiKey(config, env = process.env) {
  const { baseUrl, apiKeyEnv } = config.settings;
  if (apiKeyEnv === 'OPENAI_API_KEY') {
    if (baseUrl !== OFFICIAL_URL) {
      throw new Error('OPENAI_API_KEY 只用于 OpenAI 官方地址。请为网关配置独立的 Key。');
    }
  } else {
    const urlEnv = apiKeyEnv.replace(/_API_KEY$/, '_BASE_URL');
    const global = config.globalBinding;
    let boundUrl = global?.keyEnv === apiKeyEnv ? global.baseUrl : undefined;
    if (env[urlEnv]) boundUrl = normalizeBaseUrl(env[urlEnv]);
    if (boundUrl !== baseUrl) {
      throw new Error(`请在 ${urlEnv} 或全局配置中把 ${apiKeyEnv} 绑定到当前 API 根地址。`);
    }
  }
  const key = env[apiKeyEnv]?.trim();
  if (!key) throw new Error(`缺少环境变量 ${apiKeyEnv}。请在启动 Agent 的环境中注入 API Key。`);
  return key;
}
