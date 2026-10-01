// 搬家：把这台电脑上的账号数据（server/data/accounts.json）导入到新部署的服务器（比如 Render 上的）。
// 新服务器上一个账号都没有、并且刚启动 30 分钟内才能导入（只能导一次）。
// 用法：node tools/migrate-accounts.mjs https://你的服务.onrender.com
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = (process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(target)) {
  console.log('用法：node tools/migrate-accounts.mjs https://你的服务.onrender.com');
  process.exit(1);
}
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data', 'accounts.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const r = await fetch(target + '/api/account/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data }) });
const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
console.log(j.ok ? `导入成功：${j.count} 个账号` : `导入失败：${j.error}`);
