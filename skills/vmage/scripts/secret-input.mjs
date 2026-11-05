import { emitKeypressEvents } from 'node:readline';

// User-run local terminal only; no argv, pipes, shell expansion or echoed secret.
export function readSecret(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('请在自己的交互式终端运行 --set-key；不接受管道或命令行密钥。'));
  }
  return new Promise((resolve, reject) => {
    const wasRaw = Boolean(input.isRaw);
    const wasFlowing = input.readableFlowing === true;
    let secret = '';
    function finish(error) {
      input.removeListener('keypress', onKey);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
      process.removeListener('SIGTERM', onTerm);
      process.removeListener('SIGINT', onTerm);
      input.setRawMode(wasRaw);
      if (!wasFlowing) input.pause();
      output.write('\n');
      const value = secret;
      secret = '';
      if (error) reject(error); else resolve(value);
    }
    function onEnd() { finish(new Error('密钥输入已结束，未保存。')); }
    function onError() { finish(new Error('密钥输入失败，未保存。')); }
    function onTerm() { finish(new Error('已取消密钥设置。')); }
    function onKey(str, key = {}) {
      if (key.ctrl && ['c', 'd'].includes(key.name)) return onTerm();
      if (key.name === 'return' || key.name === 'enter') return finish();
      if (key.name === 'backspace') { secret = [...secret].slice(0, -1).join(''); return; }
      if (key.ctrl && key.name === 'u') { secret = ''; return; }
      if (!key.ctrl && !key.meta && str && !/[\x00-\x20\x7f-\x9f]/.test(str)) secret += str;
    }
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.on('keypress', onKey);
    input.once('end', onEnd);
    input.once('error', onError);
    process.once('SIGTERM', onTerm);
    process.once('SIGINT', onTerm);
    output.write('API Key（输入不显示，Ctrl+C 取消）: ');
    input.resume();
  });
}
