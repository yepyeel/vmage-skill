import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

export async function workspace(t) {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'vmage-test-')));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const home = join(temp, 'home');
  const root = join(home, 'client project');
  const cwd = join(root, 'src');
  await mkdir(cwd, { recursive: true });
  const globalDir = join(temp, 'preferences');
  const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: globalDir };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return {
    home, root, cwd, env,
    globalFile: join(globalDir, 'vmage', 'config.json'),
    projectFile: join(root, '.vmage.json'),
  };
}
