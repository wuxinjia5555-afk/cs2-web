// 公网隧道：用 ssh 连 pinggy.io（443 端口，免注册；连不上再试 localhost.run），把本机的游戏服务器映射成一个公网 https 地址。
// 地址会写进 server/public-url.txt，游戏主菜单的「手机扫码」会直接显示它；断线 / 免费隧道 60 分钟到期后会自动重连换新地址。
// 用法：先启动服务器，再运行  node tools/tunnel.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'server', 'public-url.txt');
const PORT = Number(process.env.PORT) || 8080;
let wait = 2000, fails = 0;
const COMMON = ['-T', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=' + path.join(os.tmpdir(), 'defuse_known_hosts'),
  '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=15'];
const PROVIDERS = [
  [...COMMON, '-p', '443', `-R0:localhost:${PORT}`, 'a.pinggy.io'],
  [...COMMON, '-R', `80:localhost:${PORT}`, 'nokey@localhost.run'],
];

function start() {
  const args = PROVIDERS[fails % PROVIDERS.length];
  let got = false;
  const ssh = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const onData = (buf) => {
    const s = buf.toString();
    process.stdout.write(s);
    const m = s.match(/https:\/\/[a-z0-9.-]+\.(pinggy-free\.link|pinggy\.link|pinggy\.net|lhr\.life|localhost\.run)/i);
    if (m && !got) {
      got = true;
      fs.writeFileSync(OUT, m[0]);
      console.log('\n[隧道] 公网地址：' + m[0]);
      wait = 2000;
    }
  };
  ssh.stdout.on('data', onData);
  ssh.stderr.on('data', onData);
  ssh.on('exit', (code) => {
    if (!got) fails++;
    console.log(`[隧道] 连接断开（${code}），${wait / 1000} 秒后重连`);
    try { fs.unlinkSync(OUT); } catch {}
    setTimeout(start, wait);
    wait = Math.min(60000, wait * 2);
  });
}

start();
