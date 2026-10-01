// 公网隧道：用 ssh 连 pinggy.io（443 端口，免注册；连不上再试 localhost.run），把本机的游戏服务器映射成一个公网 https 地址。
// 地址会写进 server/public-url.txt，游戏主菜单的「手机扫码」会直接显示它。
// pinggy 免费隧道 60 分钟就到期：到第 52 分钟先开好下一条（新地址写进文件），旧的那条留着直到到期。
// 这段重叠时间里，已经打开的页面会自动跳到新地址（设置一起带过去），对局里的人断线重连也会连新地址。
// 公告页（可选）：server/data/notify.json 里写了 {"ntfy": "频道名"} 的话，每换一次地址就把新地址发到 https://ntfy.sh/频道名
// （手机收藏这个页面，打开就能看到最新地址；装 ntfy App 订阅这个频道还能收到推送）。删掉这个文件就不发了。
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
const URL_RE = /https:\/\/[a-z0-9.-]+\.(pinggy-free\.link|pinggy\.link|pinggy\.net|lhr\.life|localhost\.run)/gi;
const NOTIFY = path.join(here, '..', 'server', 'data', 'notify.json');
let wait = 2000, fails = 0;
let newest = null; // 最新的一条隧道（地址写在文件里的那条）
const COMMON = ['-T', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=' + path.join(os.tmpdir(), 'defuse_known_hosts'),
  '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=15'];
const PROVIDERS = [
  [...COMMON, '-p', '443', `-R0:localhost:${PORT}`, 'a.pinggy.io'],
  [...COMMON, '-R', `80:localhost:${PORT}`, 'nokey@localhost.run'],
];
const stamp = () => new Date().toTimeString().slice(0, 8);

// 把新地址发到公告页（ntfy.sh 上的一个频道）
async function announce(url) {
  let topic = '';
  try { topic = JSON.parse(fs.readFileSync(NOTIFY, 'utf8')).ntfy || ''; } catch {}
  if (!topic) return;
  const until = /pinggy/i.test(url) ? new Date(Date.now() + 60 * 60000).toTimeString().slice(0, 5) : '';
  try {
    const r = await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic, title: 'DEFUSE 新网址', click: url, tags: ['video_game'],
        message: url + (until ? `\n${until} 左右到期，到时候这里会发下一条。` : ''),
        actions: [{ action: 'view', label: '打开游戏', url }],
      }),
    });
    console.log(`[公告 ${stamp()}] ${r.ok ? '新地址已发到公告页' : `发送失败（${r.status}）`}：https://ntfy.sh/${topic}`);
  } catch (e) {
    console.log(`[公告 ${stamp()}] 发送失败：${e.message}`);
  }
}

function start(reason = '') {
  const args = PROVIDERS[fails % PROVIDERS.length];
  const t = { got: false, url: '', timer: null, seen: [], settleT: null };
  if (reason) console.log(`[隧道 ${stamp()}] ${reason}`);
  const ssh = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  // pinggy 一次给两个地址（*.free.pinggy.net 和 *.run.pinggy-free.link），等一下收齐了再挑：优先用 free.pinggy.net
  const settle = () => {
    t.got = true;
    t.url = t.seen.find((u) => /\.free\.pinggy\.net$/i.test(u)) || t.seen[0];
    const prev = newest;
    newest = t;
    fs.writeFileSync(OUT, t.url);
    console.log(`\n[隧道 ${stamp()}] 公网地址：${t.url}${prev ? `（旧地址 ${prev.url} 保留到到期）` : ''}`);
    wait = 2000;
    fails = 0;
    if (/pinggy/i.test(t.url)) t.timer = setTimeout(() => { if (newest === t) start('免费隧道快到期了，先开好下一条'); }, ROTATE_MS);
    announce(t.url);
  };
  const onData = (buf) => {
    const s = buf.toString();
    if (!/RB: \d+, SB:/.test(s)) process.stdout.write(s); // pinggy 一直在刷流量统计，不打印
    for (const u of s.match(URL_RE) || []) if (!t.seen.includes(u)) t.seen.push(u);
    if (t.seen.length && !t.got && !t.settleT) t.settleT = setTimeout(settle, 500);
  };
  ssh.stdout.on('data', onData);
  ssh.stderr.on('data', onData);
  ssh.on('exit', (code) => {
    clearTimeout(t.timer);
    clearTimeout(t.settleT);
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
