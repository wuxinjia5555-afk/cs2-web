// 设置 / 修改开发者密码：node tools/set-dev-password.mjs 新密码
// 只把加盐哈希写进 server/data/dev.json（这个目录不进 git），不保存明文；服务器不用重启。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDevPassword } from '../server/accounts.js';

const pw = process.argv[2];
if (!pw || pw.length < 4) {
  console.log('用法：node tools/set-dev-password.mjs 新密码（至少 4 位）');
  process.exit(1);
}
setDevPassword(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'dev.json'), pw);
console.log('开发者密码已更新');
