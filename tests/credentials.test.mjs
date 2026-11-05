import assert from 'node:assert/strict';
import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { loadConfig, resolveApiKey, resolveCredential } from '../skills/vmage/scripts/config.mjs';
import { readCredentials, saveCredential } from '../skills/vmage/scripts/credentials.mjs';
import { readSecret } from '../skills/vmage/scripts/secret-input.mjs';
import { workspace, writeJson } from './workspace.mjs';

const official = { baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' };
const gateway = { baseUrl: 'https://gateway.example/tenant/v1', apiKeyEnv: 'STUDIO_API_KEY' };

test('persistent credentials are user-level, endpoint-bound and reusable across projects', async t => {
  const w = await workspace(t);
  const config = await loadConfig(w);
  saveCredential(config.credentialsPath, official, 'stored-official');
  saveCredential(config.credentialsPath, gateway, 'stored-gateway');
  saveCredential(config.credentialsPath, official, 'rotated-official');
  assert.equal(readCredentials(config.credentialsPath).credentials.length, 2);
  assert.deepEqual(resolveCredential(config, {}), { key: 'rotated-official', source: 'file' });
  assert.equal(resolveApiKey(await loadConfig({ ...w, cwd: w.home }), {}), 'rotated-official');
  await writeJson(w.projectFile, gateway);
  assert.equal(resolveApiKey(await loadConfig(w), {}), 'stored-gateway');
  await writeJson(w.projectFile, { ...gateway, baseUrl: 'https://gateway.example/other/v1' });
  const awaitConfig = await loadConfig(w);
  assert.throws(() => resolveApiKey(awaitConfig, {}), /STUDIO_BASE_URL/);
  if (process.platform !== 'win32') assert.equal((await stat(config.credentialsPath)).mode & 0o777, 0o600);
});

test('environment overrides the file without reading it, but wrong bindings never fall back', async t => {
  const w = await workspace(t);
  await writeJson(w.globalFile, gateway);
  const config = await loadConfig(w);
  saveCredential(config.credentialsPath, gateway, 'stored-gateway');
  assert.deepEqual(resolveCredential(config, { STUDIO_API_KEY: 'env-gateway' }), { key: 'env-gateway', source: 'environment' });
  assert.throws(() => resolveApiKey(config, { STUDIO_API_KEY: 'env-key', STUDIO_BASE_URL: 'https://other.example/v1' }), /STUDIO_BASE_URL/);
  assert.equal(resolveApiKey(config, { STUDIO_API_KEY: '  ' }), 'stored-gateway');
  await writeFile(config.credentialsPath, '{malformed secret');
  assert.equal(resolveApiKey(config, { STUDIO_API_KEY: 'env-only' }), 'env-only');
  assert.throws(() => resolveApiKey(config, {}), /格式无效/);
  assert.throws(() => saveCredential(config.credentialsPath, gateway, 'replacement'), /格式无效/);
  assert.equal(await readFile(config.credentialsPath, 'utf8'), '{malformed secret');
});

test('unsafe file permissions, incomplete writes and invalid keys fail without replacing credentials', async t => {
  const w = await workspace(t);
  const config = await loadConfig(w);
  saveCredential(config.credentialsPath, official, 'existing-key');
  const before = await readFile(config.credentialsPath, 'utf8');
  for (const key of ['', 'key\nwith-newline', 'key with spaces']) {
    assert.throws(() => saveCredential(config.credentialsPath, official, key), /密钥或服务配置无效/);
    assert.equal(await readFile(config.credentialsPath, 'utf8'), before);
  }
  await writeFile(config.credentialsPath + '.pending', 'another writer');
  assert.throws(() => saveCredential(config.credentialsPath, official, 'new-key'), /占用/);
  assert.equal(await readFile(config.credentialsPath, 'utf8'), before);
  if (process.platform !== 'win32') {
    await chmod(config.credentialsPath, 0o644);
    assert.throws(() => readCredentials(config.credentialsPath), /chmod 600/);
  }
});

function terminal() {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = output.isTTY = true;
  input.isRaw = false;
  input.setRawMode = value => { input.isRaw = value; };
  let displayed = '';
  output.on('data', chunk => { displayed += chunk; });
  return { input, output, displayed: () => displayed };
}

test('hidden input accepts typing/paste, backspace and Enter without echo, restoring terminal', async () => {
  const tty = terminal();
  const result = readSecret(tty.input, tty.output);
  tty.input.write('test-keyX\x7f\r');
  assert.equal(await result, 'test-key');
  assert.equal(tty.displayed().includes('test-key'), false);
  assert.equal(tty.input.isRaw, false);
  assert.equal(tty.input.isPaused(), true);
  assert.equal(tty.input.listenerCount('keypress'), 0);
});

test('hidden input cancels on Ctrl+C / EOF, rejects pipes, and restores raw mode', async () => {
  for (const end of ['\x03', null]) {
    const tty = terminal();
    const result = readSecret(tty.input, tty.output);
    tty.input.write('secret');
    if (end) tty.input.write(end); else tty.input.end();
    await assert.rejects(result, /取消|结束/);
    assert.equal(tty.displayed().includes('secret'), false);
    assert.equal(tty.input.isRaw, false);
  }
  await assert.rejects(readSecret(new PassThrough(), new PassThrough()), /交互式终端/);
});

test('Windows ACL diagnostics expose only fixed stages and numeric codes, never raw errors', async t => {
  const { windowsAcl } = await import('../skills/vmage/scripts/credentials.mjs');
  const original = process.env.SystemRoot;
  process.env.SystemRoot = original ?? '/windows-test';
  t.after(() => {
    if (original === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = original;
  });
  const fail = (_command, args) => {
    assert.equal(args.includes('-EncodedCommand'), true);
    const error = new Error('sensitive raw exception');
    error.stderr = Buffer.from('sensitive raw output\nVMAGE_ACL:protect:-2147024891\n');
    throw error;
  };
  assert.throws(() => windowsAcl('/test credential', true, fail), error =>
    error.message.includes('protect') && error.message.includes('-2147024891') && !error.message.includes('sensitive'));
  assert.throws(() => windowsAcl('/test credential', false, () => {
    const error = new Error('sensitive startup error');
    error.stderr = Buffer.from('sensitive unstructured output');
    throw error;
  }), error => error.message.includes('PowerShell') && !error.message.includes('sensitive'));
});
