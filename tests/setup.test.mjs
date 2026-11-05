import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { saveCredential } from '../skills/vmage/scripts/credentials.mjs';
import { workspace, writeJson } from './workspace.mjs';

const script = fileURLToPath(new URL('../skills/vmage/scripts/setup.mjs', import.meta.url));
const gateway = 'https://gateway.example/tenant/v1';
function run(w, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [script, ...args], { cwd: w.cwd, env: w.env, timeout: 10000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        resolve({ code: error?.code ?? 0, stdout, stderr });
      });
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}
async function ok(w, args, input) {
  const result = await run(w, args, input);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('check is read-only and distinguishes missing credentials from a readable key', async t => {
  const w = await workspace(t);
  const first = await ok(w, ['--check']);
  assert.equal(first.credentials.status, 'needs_credentials');
  assert.equal(first.paths.global, w.globalFile);
  assert.equal(first.generationTested, false);
  assert.deepEqual(await readdir(w.cwd), []);
  await assert.rejects(readFile(w.globalFile), { code: 'ENOENT' });
  w.env.OPENAI_API_KEY = 'never-print-this-key';
  const second = await ok(w, ['--check']);
  assert.equal(second.credentials.status, 'ready');
  assert.equal(JSON.stringify(second).includes(w.env.OPENAI_API_KEY), false);
});

test('global setup saves without a key, merges preferences and exposes project overrides', async t => {
  const w = await workspace(t);
  await writeJson(w.globalFile, { quality: 'high', outputDir: 'pictures' });
  await writeJson(w.projectFile, { model: 'project-model' });
  const result = await ok(w, ['--scope', 'global'], { baseUrl: gateway + '/', model: 'image2.6' });
  assert.equal(result.saved, true);
  assert.equal(result.path, w.globalFile);
  assert.equal(result.credentials.status, 'needs_credentials');
  assert.deepEqual(result.overriddenFields, ['model']);
  assert.deepEqual(JSON.parse(await readFile(w.globalFile)), {
    quality: 'high', outputDir: 'pictures', baseUrl: gateway, model: 'image2.6', apiKeyEnv: 'VMAGE_API_KEY',
  });
  w.env.VMAGE_API_KEY = 'gateway-key';
  assert.equal((await ok(w, ['--check'])).credentials.status, 'ready');
  w.env.VMAGE_BASE_URL = 'https://other.example/v1';
  assert.equal((await ok(w, ['--check'])).credentials.status, 'needs_credentials');
});

test('project initialization discovers Git root and cannot authorize gateway keys by itself', async t => {
  const w = await workspace(t);
  await mkdir(join(w.root, '.git'));
  w.env.STUDIO_API_KEY = 'never-print-studio-key';
  const result = await ok(w, ['--scope', 'project'], {
    baseUrl: gateway, model: 'provider-model', apiKeyEnv: 'STUDIO_API_KEY',
  });
  assert.equal(result.path, w.projectFile);
  assert.match(result.credentials.message, /STUDIO_BASE_URL/);
  await assert.rejects(readFile(w.globalFile), { code: 'ENOENT' });
  w.env.STUDIO_BASE_URL = gateway;
  assert.equal((await ok(w, ['--check'])).credentials.status, 'ready');
  assert.equal((await ok(w, ['--scope', 'project'], { quality: 'low' })).settings.model, 'provider-model');
});

test('non-Git project uses cwd and service changes reset only the credential selector', async t => {
  const w = await workspace(t);
  const first = await ok(w, ['--scope', 'project'], { model: 'test' });
  assert.equal(first.path, join(w.cwd, '.vmage.json'));
  await ok(w, ['--scope', 'global'], { baseUrl: gateway, apiKeyEnv: 'STUDIO_API_KEY', size: '1024x1024' });
  await ok(w, ['--scope', 'global'], { baseUrl: gateway });
  assert.equal(JSON.parse(await readFile(w.globalFile)).apiKeyEnv, 'STUDIO_API_KEY');
  await ok(w, ['--scope', 'global'], { baseUrl: 'https://api.openai.com/v1' });
  const saved = JSON.parse(await readFile(w.globalFile));
  assert.equal(saved.apiKeyEnv, 'OPENAI_API_KEY');
  assert.equal(saved.size, '1024x1024');
});

test('invalid input never damages existing configuration or echoes secret input', async t => {
  const w = await workspace(t);
  await writeJson(w.globalFile, { model: 'existing' });
  const original = await readFile(w.globalFile, 'utf8');
  for (const input of [
    '{broken-secret-value', {}, [], { apiKey: 'secret-value' }, { 'secret-value': 'x' },
    { baseUrl: 'https://secret-value@gateway.example/v1' }, { size: 'secret-value' },
    { baseUrl: gateway, apiKeyEnv: 'OPENAI_API_KEY' },
  ]) {
    const result = await run(w, ['--scope', 'global'], input);
    assert.equal(result.code, 1);
    assert.equal((result.stdout + result.stderr).includes('secret-value'), false);
    assert.equal(await readFile(w.globalFile, 'utf8'), original);
  }
  await writeFile(w.globalFile, '{broken');
  assert.equal((await run(w, ['--scope', 'global'], { model: 'replacement' })).code, 1);
  assert.equal(await readFile(w.globalFile, 'utf8'), '{broken');
});

test('check and save are exclusive; pending writes and symlink targets are preserved', async t => {
  const w = await workspace(t);
  await writeJson(w.globalFile, { model: 'existing' });
  assert.equal((await run(w, ['--check', '--scope', 'global'], { model: 'new' })).code, 1);
  const pending = w.globalFile + '.vmage-setup';
  await writeFile(pending, 'another writer');
  assert.equal((await run(w, ['--scope', 'global'], { model: 'new' })).code, 1);
  assert.equal(await readFile(pending, 'utf8'), 'another writer');
  await symlink(w.globalFile, join(w.cwd, '.vmage.json'));
  assert.equal((await run(w, ['--scope', 'project'], { model: 'new' })).code, 1);
  assert.deepEqual(JSON.parse(await readFile(w.globalFile)), { model: 'existing' });
});


test('check reports persistent source without the key; set-key refuses pipes and mixed modes', async t => {
  const w = await workspace(t);
  const initial = await ok(w, ['--check']);
  saveCredential(initial.paths.credentials, initial.settings, 'persistent-secret');
  const result = await ok(w, ['--check']);
  assert.deepEqual(result.credentials, { status: 'ready', source: 'file' });
  assert.equal(JSON.stringify(result).includes('persistent-secret'), false);
  w.env.OPENAI_API_KEY = 'environment-secret';
  assert.equal((await ok(w, ['--check'])).credentials.source, 'environment');
  const attempt = await run(w, ['--set-key'], 'never-read-this');
  assert.equal(attempt.code, 1);
  assert.match(attempt.stderr, /交互式终端/);
  assert.equal((attempt.stdout + attempt.stderr).includes('never-read-this'), false);
  assert.equal((await run(w, ['--set-key', '--check'])).code, 1);
});
