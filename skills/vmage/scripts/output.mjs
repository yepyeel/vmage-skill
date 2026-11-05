import { randomUUID } from 'node:crypto';
import { constants, lstatSync } from 'node:fs';
import { copyFile, link, mkdir, open, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';

export function outputPath(root, outputDir, requested) {
  const path = requested === undefined
    ? resolve(root, outputDir, `vmage-${randomUUID()}.png`)
    : resolve(root, requested);
  if (extname(path).toLowerCase() !== '.png') throw new Error('输出文件请使用 .png 扩展名。');
  return path;
}

async function publish(pending, path) {
  try {
    await link(pending, path);
  } catch (error) {
    // Some removable drives do not support hard links. Keep no-overwrite semantics there too.
    if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS'].includes(error.code)) throw error;
    await copyFile(pending, path, constants.COPYFILE_EXCL);
  }
}

export async function writeGeneration(path, generate) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const pending = join(directory, `.${basename(path)}.vmage-part`);
  let file;
  let preserveImage = false;
  try {
    // Reserve this name before submitting a potentially billable request.
    file = await open(pending, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`输出名已被占用。请换文件名，或在确认生成进程已退出后清理 ${pending}。`);
    }
    throw error;
  }
  try {
    if (lstatSync(path, { throwIfNoEntry: false })) {
      throw new Error(`输出文件已存在，请使用新文件名：${path}`);
    }
    await file.writeFile(await generate());
    try {
      // Publish complete bytes without replacing a file created during the request.
      await publish(pending, path);
    } catch (error) {
      preserveImage = true;
      throw new Error(`PNG 已生成，但目标文件无法创建（${error.code}）。可从 ${pending} 取回图片。`);
    }
  } finally {
    try {
      await file.close();
    } finally {
      if (!preserveImage) await unlink(pending);
    }
  }
}
