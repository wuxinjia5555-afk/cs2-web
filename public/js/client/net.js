// 网络层：WsNet 连接真实服务器；LocalNet 在浏览器里直接运行房间逻辑（离线练习）
import { Room } from '../shared/room.js';
import { TICK_RATE } from '../shared/constants.js';

export class WsNet {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.onmessage = null;
    this.onclose = null;
    this.isLocal = false;
  }
  connect(timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const timer = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch {} reject(new Error('连接超时')); } }, timeoutMs);
      ws.onopen = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
      ws.onerror = () => { if (done) return; done = true; clearTimeout(timer); reject(new Error('无法连接服务器')); };
      ws.onclose = () => { if (this.onclose) this.onclose(); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (this.onmessage) this.onmessage(m);
      };
    });
  }
  get open() { return !!this.ws && this.ws.readyState === 1; }
  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  update() {}
  close() { if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch {} } }
}

export class LocalNet {
  constructor(roomOpts, name) {
    this.isLocal = true;
    this.onmessage = null;
    this.onclose = null;
    this.inbox = [];
    this.acc = 0;
    this.pid = -1;
    this.room = new Room({ ...roomOpts, warmup: false, code: 'LOCAL' }, {
      send: (pid, msg) => { if (pid === this.pid) this.inbox.push(JSON.stringify(msg)); },
      broadcast: (msg, except) => { if (except !== this.pid) this.inbox.push(JSON.stringify(msg)); },
    });
    this.name = name;
  }
  connect() {
    this.room.addHuman(this.name, (p) => { this.pid = p.id; });
    this.pump();
    return Promise.resolve();
  }
  get open() { return true; }
  send(msg) {
    if (msg.t === 'ping') { this.inbox.push(JSON.stringify({ t: 'pong', c: msg.c })); return; }
    this.room.handle(this.pid, JSON.parse(JSON.stringify(msg)));
  }
  pump() {
    const box = this.inbox;
    this.inbox = [];
    for (const s of box) if (this.onmessage) this.onmessage(JSON.parse(s));
  }
  update(dt) {
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= 1 / TICK_RATE && n < 6) {
      this.room.tick();
      this.acc -= 1 / TICK_RATE;
      n++;
    }
    if (n >= 6) this.acc = 0;
    this.pump();
  }
  close() {}
}

export function defaultServerUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
