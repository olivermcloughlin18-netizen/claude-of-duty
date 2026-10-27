import WebSocket from 'ws';
import { createServer } from '../server.js';

export async function startServer(opts = {}) {
  const server = createServer({ tickMs: 20, killLimit: 2, respawnMs: 150, ...opts });
  const port = await server.listen(0);
  return { server, port, url: `ws://127.0.0.1:${port}` };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function client(url, headers) {
  const ws = new WebSocket(url, { headers });
  const log = [];
  const waiters = [];
  const c = { ws, log, closed: null, id: null, room: null };
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    log.push(m);
    for (const w of [...waiters]) if (w.type === m.t && (!w.pred || w.pred(m))) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  ws.on('close', (code) => { c.closed = code; for (const w of waiters) w.reject(new Error(`closed ${code} waiting ${w.type}`)); });
  ws.on('error', () => {});
  c.open = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  c.send = (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  c.wait = (type, pred, ms = 2000) => {
    const hit = log.find((m) => m.t === type && (!pred || pred(m)));
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const w = { type, pred, resolve, reject };
      waiters.push(w);
      setTimeout(() => reject(new Error(`timeout waiting ${type}`)), ms).unref();
    });
  };
  c.count = (type) => log.filter((m) => m.t === type).length;
  c.join = async (room = null, name = 'Tester') => {
    await c.open;
    c.send({ t: 'join', room, name });
    const j = await c.wait('joined');
    c.id = j.id; c.room = j.room;
    return j;
  };
  c.closedP = new Promise((res) => ws.on('close', res));
  return c;
}

export const state = (pos, extra = {}) => ({ t: 'state', pos, yaw: 0, pitch: 0, vel: [0, 0, 0], weaponId: 'sa58', crouch: false, ...extra });
