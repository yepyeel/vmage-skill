const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const pngEnd = Buffer.from('0000000049454e44ae426082', 'hex');

function hasPngChunks(bytes) {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(pngSignature) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      !bytes.readUInt32BE(16) || !bytes.readUInt32BE(20) || !bytes.subarray(-12).equals(pngEnd)) {
    return false;
  }
  let hasPixels = false;
  // The 33-byte signature + IHDR is followed by length-prefixed chunks.
  for (let at = 33; at + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    at += length + 12;
    if (type === 'IDAT' && length > 0) hasPixels = true;
    if (type === 'IEND') return hasPixels && at === bytes.length && length === 0;
  }
  return false;
}

function decodePng(encoded) {
  if (typeof encoded !== 'string' || !encoded.trim()) {
    throw new Error('接口没有返回 data[0].b64_json，请确认网关实现了 GPT Image 生图协议。');
  }
  const base64 = encoded.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1 ||
      (base64.endsWith('=') && base64.length % 4 !== 0)) {
    throw new Error('接口返回的 b64_json 不是有效的 Base64 图片。');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!hasPngChunks(bytes)) {
    throw new Error('接口返回的图片不是完整的 PNG。');
  }
  return bytes;
}

const statusHints = new Map([
  [400, '请检查模型、尺寸、画质和提示词是否受所选接口支持。'],
  [401, '请检查当前服务对应的 API Key。'],
  [403, '请检查 API Key 的生图权限和模型访问权限。'],
  [404, '请检查 API 根地址、模型名及网关的 /images/generations 接口。'],
  [429, '请检查账户额度或限流情况。'],
]);

export async function generateImage({ baseUrl, model, size, quality }, apiKey, prompt) {
  const body = { model, prompt, n: 1, output_format: 'png' };
  if (size) body.size = size;
  if (quality) body.quality = quality;

  let response;
  let data;
  try {
    response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(300_000),
    });
    if (response.ok) data = await response.json();
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('生图请求超时，服务端可能已处理。请先核实请求状态再重试。');
    }
    if (error instanceof SyntaxError) throw new Error('生图接口返回了无效的 JSON。');
    throw new Error('生图连接失败或响应中断。请检查网络和服务地址，确认请求状态后再重试。');
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`生图接口返回重定向（HTTP ${response.status}）。请直接配置最终 API 根地址。`);
    }
    const hint = statusHints.get(response.status) ?? '请检查生图服务的状态。';
    throw new Error(`生图请求失败（HTTP ${response.status}）。${hint}`);
  }
  return decodePng(data?.data?.[0]?.b64_json);
}
