import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig, resolveApiKey } from '../skills/vmage/scripts/config.mjs';
import { workspace, writeJson } from './workspace.mjs';

const official = 'https://api.openai.com/v1';
const studio = 'https://gateway.example/openai/v1';

test('defaults to the official endpoint; only generation needs the official key', async t => {
  const w = await workspace(t);
  await writeJson(join(w.home, '.vmage.json'), { model: 'unrelated-home-file' });
  const config = await loadConfig(w);
  assert.equal(config.projectRoot, w.cwd);
  assert.equal(config.projectConfig, null);
  assert.equal(config.settings.baseUrl, official);
  assert.equal(config.settings.model, 'gpt-image-2.5-flare');
  assert.throws(() => resolveApiKey(config, {}), /缺少环境变量 OPENAI_API_KEY/);
  assert.equal(resolveApiKey(config, { OPENAI_API_KEY: 'official-test' }), 'official-test');
});

test('each field follows CLI > nearest project > global > environment > defaults', async t => {
  const w = await workspace(t);
  Object.assign(w.env, { VMAGE_BASE_URL: 'https://env.example/v1', VMAGE_MODEL: 'env-model' });
  await writeJson(w.globalFile, {
    baseUrl: studio + '/', model: 'global-model', outputDir: 'images', size: '1024x1024', quality: 'low',
  });
  await writeJson(w.projectFile, { model: 'project-model', size: '1536x1024' });
  const config = await loadConfig({ ...w, overrides: { quality: 'high' } });
  assert.deepEqual(config.settings, {
    baseUrl: studio, model: 'project-model', apiKeyEnv: 'VMAGE_API_KEY',
    size: '1536x1024', quality: 'high', outputDir: 'images',
  });
  assert.equal(config.projectRoot, w.root);
  assert.equal(config.projectConfig, w.projectFile);
  assert.equal(config.globalConfig, w.globalFile);
  const otherProject = await loadConfig({ ...w, cwd: w.home });
  assert.equal(otherProject.settings.model, 'global-model');
  assert.equal(otherProject.settings.size, '1024x1024');
});

test('the closest project wins and a nested Git worktree bounds discovery', async t => {
  const w = await workspace(t);
  await writeJson(w.projectFile, { model: 'parent' });
  await writeFile(join(w.cwd, '.git'), 'gitdir: /example/worktrees/child');
  const child = await loadConfig(w);
  assert.equal(child.projectRoot, w.cwd);
  assert.equal(child.projectConfig, null);
  await writeJson(join(w.cwd, '.vmage.json'), { model: 'nested' });
  assert.equal((await loadConfig(w)).settings.model, 'nested');
});

test('a matching global gateway credential survives ordinary project overrides', async t => {
  const w = await workspace(t);
  await writeJson(w.globalFile, { baseUrl: studio, apiKeyEnv: 'STUDIO_API_KEY' });
  await writeJson(w.projectFile, { model: 'project-alias' });
  const config = await loadConfig(w);
  assert.equal(resolveApiKey(config, { STUDIO_API_KEY: 'studio-test' }), 'studio-test');
  const differentBinding = { STUDIO_API_KEY: 'other-key', STUDIO_BASE_URL: 'https://other.example/v1' };
  assert.throws(() => resolveApiKey(config, differentBinding), /STUDIO_BASE_URL/);
});

test('a project can select its own key even on the same endpoint', async t => {
  const w = await workspace(t);
  await writeJson(w.globalFile, { baseUrl: studio, apiKeyEnv: 'STUDIO_API_KEY' });
  await writeJson(w.projectFile, { apiKeyEnv: 'CLIENT_API_KEY' });
  Object.assign(w.env, { CLIENT_BASE_URL: studio, CLIENT_API_KEY: 'client', STUDIO_API_KEY: 'studio' });
  assert.equal(resolveApiKey(await loadConfig(w), w.env), 'client');
});

test('changing the endpoint or tenant path never borrows another service’s key', async t => {
  const w = await workspace(t);
  await writeJson(w.globalFile, { baseUrl: studio, apiKeyEnv: 'STUDIO_API_KEY' });
  Object.assign(w.env, { OPENAI_API_KEY: 'official', STUDIO_API_KEY: 'studio', VMAGE_API_KEY: 'old' });
  const baseUrl = 'https://gateway.example/another-tenant/v1';
  await writeJson(w.projectFile, { baseUrl });
  let config = await loadConfig(w);
  assert.equal(config.settings.apiKeyEnv, 'VMAGE_API_KEY');
  assert.throws(() => resolveApiKey(config, w.env), /VMAGE_BASE_URL/);
  await writeJson(w.projectFile, { baseUrl, apiKeyEnv: 'STUDIO_API_KEY' });
  config = await loadConfig(w);
  assert.throws(() => resolveApiKey(config, w.env), /STUDIO_BASE_URL/);
  await writeJson(w.projectFile, { baseUrl, apiKeyEnv: 'OPENAI_API_KEY' });
  config = await loadConfig(w);
  assert.throws(() => resolveApiKey(config, w.env), /官方地址/);
});

test('the VMAGE environment variables work together without either config file', async t => {
  const w = await workspace(t);
  Object.assign(w.env, { VMAGE_BASE_URL: studio + '/', VMAGE_MODEL: 'alias', VMAGE_API_KEY: 'gateway' });
  const config = await loadConfig(w);
  assert.equal(config.settings.baseUrl, studio);
  assert.equal(config.settings.model, 'alias');
  assert.equal(resolveApiKey(config, w.env), 'gateway');
});

test('a relative XDG path cannot promote a project file to trusted global configuration', async t => {
  const w = await workspace(t);
  w.env.XDG_CONFIG_HOME = 'preferences';
  const personal = join(w.home, '.config', 'vmage', 'config.json');
  await writeJson(personal, { model: 'personal-default' });
  assert.equal((await loadConfig(w)).globalConfig, personal);
});

test('invalid settings fail locally, even if the key accidentally appears in the input', async t => {
  const w = await workspace(t);
  for (const value of [
    { apiKey: 'secret-test-value' }, { baseUrl: 'https://secret-test-value@gateway.example/v1' },
    { baseUrl: 'https://gateway.example/v1?api_key=secret-test-value' }, { size: 'large' },
    { quality: 'unknown' }, { model: 42 }, { outptDir: 'typo' }, [],
  ]) {
    await writeJson(w.projectFile, value);
    await assert.rejects(loadConfig(w), error => !error.message.includes('secret-test-value'));
  }
  await writeFile(w.projectFile, '{broken json containing secret-test-value');
  await assert.rejects(loadConfig(w), /无效的 JSON/);
});
