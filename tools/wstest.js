// 联机冒烟测试：两个客户端连接服务器，创建/加入房间，收发消息（需先启动服务器）
const URL_BASE = process.argv[2] || 'http://localhost:8080';
const WS_URL = URL_BASE.replace(/^http/, 'ws') + '/ws';

function client(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const c = { ws, name, counts: {}, msgs: [], id: null, init: null };
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: 'hello', name }));
      resolve(c);
    };
    ws.onerror = (e) => reject(new Error('连接失败 ' + e.message));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      c.counts[m.t] = (c.counts[m.t] || 0) + 1;
      c.msgs.push(m);
      if (m.t === 'init') { c.init = m; c.id = m.you; }
    };
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (c, m) => c.ws.send(JSON.stringify(m));

const res = await fetch(URL_BASE + '/');
console.log('GET / ->', res.status, (await res.text()).length, '字节');
const js = await fetch(URL_BASE + '/js/shared/room.js');
console.log('GET room.js ->', js.status, js.headers.get('content-type'));

const a = await client('测试甲');
send(a, { t: 'create', opts: { map: 'arena', mode: 'bomb', bots: true, botDiff: 1, teamSize: 2, maxRounds: 8 } });
await sleep(400);
console.log('甲 init:', !!a.init, '房间', a.init?.code, '地图', a.init?.map, '玩家数', a.init?.players.length);
send(a, { t: 'team', team: 'CT' });

const b = await client('测试乙');
send(b, { t: 'join', code: a.init.code });
await sleep(400);
console.log('乙 init:', !!b.init, '房间', b.init?.code);
send(b, { t: 'team', team: 'T' });
await sleep(300);
send(a, { t: 'start' });
await sleep(1500);

// 大消息（测试 126/127 长度编码）
send(a, { t: 'chat', text: '你好'.repeat(50) });
const big = { t: 'noop', pad: 'x'.repeat(70000) };
send(a, big);
await sleep(300);

// 模拟移动与开枪
const spawn = [...a.msgs].reverse().find((m) => m.t === 'spawn');
if (spawn) {
  for (let i = 0; i < 20; i++) {
    send(a, { t: 'st', p: [spawn.p[0], spawn.p[1], spawn.p[2] - i * 0.1], v: [0, 0, -3], a: [spawn.yaw, 0], f: 4 | 8, pg: 30 });
    await sleep(33);
  }
}
await sleep(2500);
console.log('甲 收到消息类型:', JSON.stringify(a.counts));
console.log('乙 收到消息类型:', JSON.stringify(b.counts));
const chat = b.msgs.find((m) => m.t === 'chat');
console.log('乙 收到聊天:', chat ? chat.n + ': ' + chat.tx.slice(0, 10) + '…' : '无');
const lastSnap = [...b.msgs].reverse().find((m) => m.t === 's');
console.log('快照玩家数:', lastSnap?.ps.length, '服务器时间', lastSnap?.st);
const rooms = await (await fetch(URL_BASE + '/api/rooms')).json();
console.log('房间列表:', JSON.stringify(rooms));
a.ws.close();
b.ws.close();
await sleep(300);
process.exit(0);
