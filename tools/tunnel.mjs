// 公网隧道：用 ssh 连 pinggy.io（443 端口，免注册；连不上再试 localhost.run），把本机的游戏服务器映射成一个公网 https 地址。
// 地址会写进 server/public-url.txt，游戏主菜单的「手机扫码」会直接显示它。
// pinggy 免费隧道 60 分钟就到期：到第 52 分钟先开好下一条（新地址写进文件），旧的那条留着直到到期。
// 这段重叠时间里，已经打开的页面会自动跳到新地址（设置一起带过去），对局里的人断线重连也会连新地址。
// 用法：先启动服务器，再运行  node tools/tunnel.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'server', 'public-url.txt');
const PORT = Number(process.env.PORT) || 8080;
const ROTATE_MS = (Number(process.env.TUNNEL_ROTATE_MIN) || 52) * 60000;
const URL_RE = /https:\/\/[a-z0-9.-]+\.(pinggy-free\.link|pinggy\.link|pinggy\.net|lhr\.life|localhost\.run)/i;
let wait = 2000, fails = 0;
let newest = null; // 最新的一条隧道（地址写在文件里的那条）
const COMMON = ['-T', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=' + path.join(os.tmpdir(), 'defuse_known_hosts'),
  '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=15'];
const PROVIDERS = [
  [...COMMON, '-p', '443', `-R0:localhost:${PORT}`, 'a.pinggy.io'],
  [...COMMON, '-R', `80:localhost:${PORT}`, 'nokey@localhost.run'],
];
const stamp = () => new Date().toTimeString().slice(0, 8);

function start(reason = '') {
  const args = PROVIDERS[fails % PROVIDERS.length];
  const t = { got: false, url: '', timer: null };
  if (reason) console.log(`[隧道 ${stamp()}] ${reason}`);
  const ssh = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const onData = (buf) => {
    const s = buf.toString();
    if (!/RB: \d+, SB:/.test(s)) process.stdout.write(s); // pinggy 一直在刷流量统计，不打印
    const m = s.match(URL_RE);
    if (m && !t.got) {
      t.got = true;
      t.url = m[0];
      const prev = newest;
      newest = t;
      fs.writeFileSync(OUT, t.url);
      console.log(`\n[隧道 ${stamp()}] 公网地址：${t.url}${prev ? `（旧地址 ${prev.url} 保留到到期）` : ''}`);
      wait = 2000;
      fails = 0;
      if (/pinggy/i.test(t.url)) t.timer = setTimeout(() => { if (newest === t) start('免费隧道快到期了，先开好下一条'); }, ROTATE_MS);
    }
  };
  ssh.stdout.on('data', onData);
  ssh.stderr.on('data', onData);
  ssh.on('exit', (code) => {
    clearTimeout(t.timer);
    if (!t.got) fails++;
    if (newest && newest !== t) {
      // 旧隧道到期关掉了（新地址早就在用）；或者提前开下一条没成功 → 过一会儿再试
      if (t.got) console.log(`[隧道 ${stamp()}] 旧地址 ${t.url} 已到期关闭`);
      else setTimeout(() => start('再试一次开下一条隧道'), 15000);
      return;
    }
    newest = null;
    console.log(`[隧道 ${stamp()}] 连接断开（${code}），${wait / 1000} 秒后重连`);
    try { fs.unlinkSync(OUT); } catch {}
    setTimeout(() => start(), wait);
    wait = Math.min(60000, wait * 2);
  });
}

start();
