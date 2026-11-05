import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { text } from 'node:stream/consumers';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { saveCredential } from '../skills/vmage/scripts/credentials.mjs';
import { generateImage } from '../skills/vmage/scripts/images.mjs';
import { writeGeneration } from '../skills/vmage/scripts/output.mjs';
import { workspace, writeJson } from './workspace.mjs';

const skill = fileURLToPath(new URL('../skills/vmage/', import.meta.url));
const script = join(skill, 'scripts', 'generate.mjs');
// One valid RGB pixel, including IDAT and IEND chunks.
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNImfoWAANHAeeBNjUAAAAAAElFTkSuQmCC';

function run(w, args, { entry = script, input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [entry, ...args], { cwd: w.cwd, env: w.env, timeout: 10_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        resolve({ code: error?.code ?? 0, stdout, stderr });
      });
    child.stdin.end(input);
  });
}

async function gateway(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/tenant/v1`;
}

test('official requests use the Images API and one PNG, with no real network call', async t => {
  const w = await workspace(t);
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, options };
    return Response.json({ data: [{ b64_json: png }] });
  });
  const config = JSON.parse((await run(w, ['--show-config'])).stdout);
  const bytes = await generateImage(config, 'local-test', '海边');
  assert.deepEqual(bytes, Buffer.from(png, 'base64'));
  assert.equal(request.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(request.options.headers.Authorization, 'Bearer local-test');
  assert.deepEqual(JSON.parse(request.options.body), {
    prompt: '海边', model: 'gpt-image-2.5-flare', n: 1, output_format: 'png',
  });
});

test('the same installed skill works in both client layouts from a nested project directory', async t => {
  const w = await workspace(t);
  const requests = [];
  const baseUrl = await gateway(t, async (req, res) => {
    requests.push({
      method: req.method, url: req.url, auth: req.headers.authorization,
      type: req.headers['content-type'], body: JSON.parse(await text(req)),
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ b64_json: png }] }));
  });
  Object.assign(w.env, { STUDIO_API_KEY: 'test-gateway-only', OPENAI_API_KEY: 'official-only' });
  await writeJson(w.globalFile, { baseUrl, apiKeyEnv: 'STUDIO_API_KEY', size: '1024x1024', quality: 'medium' });
  await writeJson(w.projectFile, { model: 'gateway-alias', size: '1536x1024' });
  const prompt = '咖啡店横版封面\n画面文字为「早安」。';
  for (const host of ['.agents', '.claude']) {
    const installed = join(w.home, host, 'skills', 'vmage');
    await cp(skill, installed, { recursive: true });
    const entry = join(installed, 'scripts', 'generate.mjs');
    const relative = `assets with spaces/${host}-封面.png`;
    const result = await run(w, ['--out', relative], { entry, input: prompt });
    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(output, { path: join(w.root, relative), mimeType: 'image/png', model: 'gateway-alias' });
    assert.deepEqual(await readFile(output.path), Buffer.from(png, 'base64'));
    assert.equal(result.stdout.includes(png), false);
    assert.deepEqual(requests.at(-1), {
      method: 'POST', url: '/tenant/v1/images/generations', auth: 'Bearer test-gateway-only',
      type: 'application/json', body: {
        model: 'gateway-alias', prompt, n: 1, output_format: 'png', size: '1536x1024', quality: 'medium',
      },
    });
    const existing = await run(w, ['--out', relative, '--prompt', '再画一张'], { entry });
    assert.equal(existing.code, 1);
    assert.match(existing.stderr, /文件已存在/);
  }
  assert.equal(requests.length, 2);
});

test('show-config is offline and reports sources without resolving or printing secrets', async t => {
  const w = await workspace(t);
  w.env.OPENAI_API_KEY = 'never-print-me';
  await writeJson(w.globalFile, { size: '1024x1024' });
  await writeJson(w.projectFile, { baseUrl: 'https://unconfigured.invalid/v1', model: 'project-model' });
  const result = await run(w, ['--show-config']);
  assert.equal(result.code, 0);
  assert.equal((result.stdout + result.stderr).includes('never-print-me'), false);
  assert.equal(JSON.parse(result.stdout).projectConfig, w.projectFile);
  const attempt = await run(w, ['--prompt', '画一张图']);
  assert.match(attempt.stderr, /VMAGE_BASE_URL/);
  assert.equal(attempt.code, 1);
});

test('default file names are unique inside the configured output folder', async t => {
  const w = await workspace(t);
  w.env.VMAGE_BASE_URL = await gateway(t, (_req, res) => res.end(JSON.stringify({ data: [{ b64_json: png }] })));
  w.env.VMAGE_API_KEY = 'gateway-test';
  await writeJson(w.projectFile, { outputDir: 'generated images' });
  const results = await Promise.all([run(w, ['--prompt', '1']), run(w, ['--prompt', '2'])]);
  const paths = results.map(result => {
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout).path;
  });
  assert.notEqual(paths[0], paths[1]);
  assert.equal(dirname(paths[0]), join(w.root, 'generated images'));
});

test('HTTP errors, redirects and malformed responses fail once and leave no output', async t => {
  const w = await workspace(t);
  w.env.VMAGE_API_KEY = 'do-not-echo';
  let calls = 0;
  const corrupt = Buffer.from(png, 'base64');
  corrupt.writeUInt32BE(10_000, 33); // Intact signature and trailer with a broken IDAT length.
  const replies = [
    [401, 'do-not-echo', /HTTP 401/],
    [429, 'quota', /HTTP 429/],
    [307, '', /重定向/],
    [200, 'not-json', /无效的 JSON/],
    [200, JSON.stringify({ data: [{ url: 'https://unused.invalid/' }] }), /b64_json/],
    [200, JSON.stringify({ data: [{ b64_json: '!!!' }] }), /Base64/],
    [200, JSON.stringify({ data: [{ b64_json: png.slice(0, -8) }] }), /PNG/],
    [200, JSON.stringify({ data: [{ b64_json: corrupt.toString('base64') }] }), /PNG/],
  ];
  w.env.VMAGE_BASE_URL = await gateway(t, (_req, res) => {
    const reply = replies[calls++];
    res.writeHead(reply?.[0] ?? 500, reply?.[0] === 307 ? { location: '/unexpected' } : {});
    res.end(reply?.[1]);
  });
  for (const [index, [, , pattern]] of replies.entries()) {
    const result = await run(w, ['--prompt', 'test', '--out', 'out/test.png']);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, pattern);
    assert.equal(result.stderr.includes(w.env.VMAGE_API_KEY), false);
    assert.deepEqual(await readdir(join(w.cwd, 'out')), []);
    assert.equal(calls, index + 1);
  }
});

test('a timeout is reported as ambiguous and is never retried', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('local simulated timeout', 'TimeoutError');
  });
  await assert.rejects(generateImage({ baseUrl: 'https://unused.invalid/v1', model: 'test' },
    'test-key', 'a picture'), /服务端可能已处理/);
  assert.equal(fetch.mock.callCount(), 1);
});

test('a concurrent invocation for one filename never submits a second generation', async t => {
  const w = await workspace(t);
  const started = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const path = join(w.root, 'locked.png');
  let calls = 0;
  const first = writeGeneration(path, async () => {
    calls++;
    started.resolve();
    await finish.promise;
    return Buffer.from(png, 'base64');
  });
  await started.promise;
  try {
    await assert.rejects(writeGeneration(path, () => { calls++; }), /已被占用/);
    await assert.rejects(readFile(path), { code: 'ENOENT' });
  } finally {
    finish.resolve();
    await first;
  }
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(path), Buffer.from(png, 'base64'));
});

test('a competing writer keeps its file and the completed image can be recovered', async t => {
  const w = await workspace(t);
  const path = join(w.root, 'result.png');
  await assert.rejects(writeGeneration(path, async () => {
    await writeFile(path, 'another writer');
    return Buffer.from(png, 'base64');
  }), /取回图片/);
  assert.equal(await readFile(path, 'utf8'), 'another writer');
  assert.deepEqual(await readFile(join(w.root, '.result.png.vmage-part')), Buffer.from(png, 'base64'));
});


test('generation uses persistent credentials without an environment key and never reports them', async t => {
  const w = await workspace(t);
  let authorization;
  const baseUrl = await gateway(t, (req, res) => {
    authorization = req.headers.authorization;
    res.end(JSON.stringify({ data: [{ b64_json: png }] }));
  });
  await writeJson(w.globalFile, { baseUrl, model: 'test-model' });
  saveCredential(join(dirname(w.globalFile), 'credentials.json'),
    { baseUrl, apiKeyEnv: 'VMAGE_API_KEY' }, 'persistent-test-key');
  const result = await run(w, ['--prompt', 'test', '--out', 'persistent.png']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(authorization, 'Bearer persistent-test-key');
  assert.equal((result.stdout + result.stderr).includes('persistent-test-key'), false);
  assert.deepEqual(await readFile(JSON.parse(result.stdout).path), Buffer.from(png, 'base64'));
  const info = await run(w, ['--show-config']);
  assert.equal(info.stdout.includes('persistent-test-key'), false);
});
