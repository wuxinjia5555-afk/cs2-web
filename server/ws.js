// 极简 WebSocket 服务端（RFC 6455），无第三方依赖
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1 << 20;

export function handleUpgrade(req, socket, head, onConnect) {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket' || !key) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);
  const ws = new WsConn(socket);
  onConnect(ws, req);
  if (head && head.length) ws._onData(head);
}

export class WsConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragLen = 0;
    this.fragOp = 0;
    this.open = true;
    this.lastSeen = Date.now();
    socket.on('data', (d) => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.open) {
      const buf = this.buf;
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        if (buf.readUInt32BE(2) !== 0) { this.close(1009); return; }
        len = buf.readUInt32BE(6);
        off = 10;
      }
      if (len > MAX_PAYLOAD) { this.close(1009); return; }
      let mask = null;
      if (masked) {
        if (buf.length < off + 4) return;
        mask = buf.subarray(off, off + 4);
        off += 4;
      }
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = buf.subarray(off + len);
      this._frame(fin, op, payload);
    }
  }

  _frame(fin, op, payload) {
    this.lastSeen = Date.now();
    if (op === 0x8) { this.close(); return; }
    if (op === 0x9) { this._send(0xa, payload); return; }
    if (op === 0xa) return;
    if (op === 0x1 || op === 0x2) {
      if (fin) this._msg(op, payload);
      else { this.fragOp = op; this.frags = [payload]; this.fragLen = payload.length; }
      return;
    }
    if (op === 0x0 && this.frags.length) {
      this.frags.push(payload);
      this.fragLen += payload.length;
      if (this.fragLen > MAX_PAYLOAD) { this.close(1009); return; }
      if (fin) {
        const all = Buffer.concat(this.frags);
        this.frags = [];
        this.fragLen = 0;
        this._msg(this.fragOp, all);
      }
    }
  }

  _msg(op, payload) {
    this.emit('message', op === 0x1 ? payload.toString('utf8') : payload);
  }

  _send(op, data) {
    if (!this.open) return;
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(len, 6);
    }
    header[0] = 0x80 | op;
    try {
      this.socket.write(Buffer.concat([header, data]));
    } catch {
      this._closed();
    }
  }

  send(str) { this._send(0x1, Buffer.from(str, 'utf8')); }
  ping() { this._send(0x9, Buffer.alloc(0)); }
  get buffered() { return this.socket.writableLength || 0; }

  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code, 0);
    this._send(0x8, b);
    this.open = false;
    try { this.socket.end(); } catch {}
    setTimeout(() => { try { this.socket.destroy(); } catch {} }, 1000);
    this.emit('close');
  }
}
