import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';

// No secret is passed to PowerShell: it only receives a path and manages its ACL.
function windowsAcl(path, protect) {
  const script = `
$ErrorActionPreference = 'Stop'
$p = $env:VMAGE_CREDENTIAL_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
${protect ? `
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'Allow')
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $p -AclObject $acl
` : ''}
$acl = Get-Acl -LiteralPath $p
if ($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'owner' }
if (-not $acl.AreAccessRulesProtected) { throw 'inheritance' }
$rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
foreach ($r in $rules) {
  if ($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -ne $sid.Value) { throw 'access' }
}
`;
  try {
    const root = process.env.SystemRoot ?? process.env.SYSTEMROOT;
    if (!root) throw new Error('Windows directory unavailable');
    execFileSync(join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, VMAGE_CREDENTIAL_PATH: path }, stdio: 'ignore', timeout: 15000,
      });
  } catch {
    throw new Error('无法设置或验证密钥文件的 Windows ACL；请使用支持 ACL 的本地文件系统，或改用环境变量。');
  }
}

function checkFile(path, stat) {
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('密钥文件必须是普通文件，不能是链接。');
  if (process.platform === 'win32') windowsAcl(path, false);
  else if ((stat.mode & 0o077) || stat.uid !== process.getuid()) {
    throw new Error('密钥文件必须归当前用户所有，且仅当前用户可读写（chmod 600）。');
  }
}

function validateStore(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.credentials)) throw new Error('schema');
  const seen = new Set();
  for (const entry of value.credentials) {
    if (!entry || typeof entry.baseUrl !== 'string' ||
      !/^[A-Z][A-Z0-9_]*_API_KEY$/.test(entry.apiKeyEnv ?? '') ||
      typeof entry.key !== 'string' || !entry.key.trim() || /[\s\x00-\x1f\x7f]/.test(entry.key)) throw new Error('schema');
    const url = new URL(entry.baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      url.href.replace(/\/+$/, '') !== entry.baseUrl) throw new Error('schema');
    const identity = JSON.stringify([entry.baseUrl, entry.apiKeyEnv]);
    if (seen.has(identity)) throw new Error('duplicate');
    seen.add(identity);
  }
  return value;
}

export function readCredentials(path) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return { version: 1, credentials: [] }; throw error; }
  checkFile(path, stat);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('密钥文件在读取时发生变化，请重试。');
    checkFile(path, opened);
    try { return validateStore(JSON.parse(readFileSync(fd, 'utf8'))); }
    catch { throw new Error('用户级密钥文件格式无效；未输出或覆盖其内容。'); }
  } finally { closeSync(fd); }
}

export function saveCredential(path, { baseUrl, apiKeyEnv }, key) {
  // Validate before creating any files. Never include input values in errors.
  const entry = { baseUrl, apiKeyEnv, key: key.trim() };
  try { validateStore({ version: 1, credentials: [entry] }); }
  catch { throw new Error('密钥或服务配置无效，密钥不能为空或包含空白和控制字符。'); }
  if (apiKeyEnv === 'OPENAI_API_KEY' && baseUrl !== 'https://api.openai.com/v1') {
    throw new Error('OPENAI_API_KEY 只用于 OpenAI 官方地址。');
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const pending = `${path}.pending`;
  let fd;
  let published = false;
  try { fd = openSync(pending, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('密钥写入已被占用；确认其他设置进程退出后再处理 .pending 文件。');
    throw error;
  }
  try {
    // Apply ACL before placing any credential bytes in the temporary file.
    if (process.platform === 'win32') windowsAcl(pending, true);
    const store = readCredentials(path);
    const entries = store.credentials.filter(item => item.baseUrl !== baseUrl || item.apiKeyEnv !== apiKeyEnv);
    entries.push(entry);
    writeFileSync(fd, JSON.stringify({ version: 1, credentials: entries }, null, 2) + '\n');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(pending, path);
    published = true;
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (!published) unlinkSync(pending);
  }
}
