// HoopsHype NBA Quiz Live: local bridge.
// 1) Serves the quiz page at http://localhost:8787
// 2) Listens to the TikTok LIVE chat/gifts/likes of the account in config.json (and, optionally, YouTube Live chat)
// 3) Forwards every event to the quiz page.
// No keys or passwords needed: it only needs the public TikTok username, and it waits until that account is LIVE.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const PORT = cfg.port || 8787;
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

// ------------------------------------------------------------------ web server + event stream
const clients = new Set();
let lastStatus = { kind: 'status', connected: false, text: 'Waiting for the TikTok LIVE to start...' };
function send(ev) {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(line);
}
function status(connected, text) {
  lastStatus = { kind: 'status', connected, text };
  send(lastStatus);
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(lastStatus)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  let file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT) || file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}.git`)) {
    res.writeHead(403); return res.end();
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => {
  log(`Quiz page ready at http://localhost:${PORT}`);
  log(`Practice mode (fake chat, no TikTok needed): http://localhost:${PORT}/?practice=1`);
});
setInterval(() => { for (const res of clients) res.write(': keep-alive\n\n'); }, 20000);

// ------------------------------------------------------------------ TikTok LIVE
async function startTikTok() {
  const user = String(cfg.tiktokUsername || '').replace(/^@/, '').trim();
  if (!user) { log('No tiktokUsername in config.json, TikTok chat is off.'); return; }
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await import('tiktok-live-connector');
  const seenGifts = new Set();
  let conn = null, retryTimer = null;

  const connect = async () => {
    clearTimeout(retryTimer);
    conn = new TikTokLiveConnection(user, { enableExtendedGiftInfo: false });
    const name = u => (u && (u.nickname || u.uniqueId)) || 'viewer';
    const id = u => (u && u.uniqueId) || 'viewer';

    conn.on(WebcastEvent.CHAT, d => {
      if (d.comment) send({ kind: 'chat', user: id(d.user), nick: name(d.user), text: d.comment, platform: 'tiktok' });
    });
    conn.on(WebcastEvent.GIFT, d => {
      const g = d.giftDetails || {};
      // Streakable gifts (giftType 1) fire many times during a combo: only count the final event
      if (g.giftType === 1 && !d.repeatEnd) return;
      const giftName = g.giftName || `Gift ${d.giftId}`;
      const coins = g.diamondCount || 1;
      const count = d.repeatCount || 1;
      if (!seenGifts.has(giftName)) { seenGifts.add(giftName); log(`New gift name seen: "${giftName}" (${coins} coins)`); }
      log(`Gift: ${name(d.user)} sent ${giftName} x${count} (${coins * count} coins)`);
      send({ kind: 'gift', user: id(d.user), nick: name(d.user), gift: giftName, coins, count, platform: 'tiktok' });
    });
    conn.on(WebcastEvent.LIKE, d => send({ kind: 'like', user: id(d.user), nick: name(d.user), count: d.likeCount || 1, total: d.totalLikeCount }));
    conn.on(WebcastEvent.FOLLOW, d => send({ kind: 'follow', user: id(d.user), nick: name(d.user) }));
    conn.on(WebcastEvent.SHARE, d => send({ kind: 'share', user: id(d.user), nick: name(d.user) }));
    conn.on(WebcastEvent.ROOM_USER, d => send({ kind: 'viewers', n: d.viewerCount }));
    conn.on(WebcastEvent.STREAM_END, () => { log('The LIVE ended.'); status(false, 'The LIVE has ended'); retry(30); });
    conn.on(ControlEvent.DISCONNECTED, () => { log('Disconnected from TikTok.'); status(false, 'Reconnecting to chat...'); retry(15); });
    conn.on(ControlEvent.ERROR, e => log('TikTok error:', (e && (e.message || e.info)) || e));

    try {
      const st = await conn.connect();
      log(`Connected to @${user}'s LIVE (room ${st.roomId}). Chat, gifts and likes are flowing.`);
      status(true, 'Connected');
    } catch (e) {
      const msg = (e && e.message) || String(e);
      if (/offline|not live|LIVE has ended|UserOffline/i.test(msg) || (e && e.constructor && e.constructor.name === 'UserOfflineError')) {
        log(`@${user} is not LIVE yet. Checking again in 20 seconds...`);
        status(false, 'Waiting for the TikTok LIVE to start...');
      } else {
        log('Could not connect to TikTok yet:', msg, '. Retrying in 30 seconds.');
        status(false, 'Connecting to chat...');
      }
      retry(/offline|not live/i.test(msg) ? 20 : 30);
    }
  };
  const retry = secs => {
    clearTimeout(retryTimer);
    try { conn && conn.disconnect && conn.disconnect(); } catch (e) {}
    retryTimer = setTimeout(connect, secs * 1000);
  };
  connect();
}

// ------------------------------------------------------------------ YouTube Live (optional, experimental)
async function startYouTube() {
  const y = cfg.youtube || {};
  if (!y.enabled) return;
  let LiveChat;
  try { ({ LiveChat } = await import('youtube-chat')); }
  catch (e) { log('YouTube chat module missing. Run INSTALL again or turn youtube off in config.json.'); return; }
  const target = y.liveId ? { liveId: y.liveId } : y.channelId ? { channelId: y.channelId } : { handle: y.handle };
  const run = async () => {
    const chat = new LiveChat(target);
    chat.on('chat', item => {
      const text = (item.message || []).map(m => m.text ?? m.emojiText ?? '').join('');
      const user = 'yt:' + (item.author.channelId || item.author.name);
      if (text) send({ kind: 'chat', user, nick: item.author.name, text, platform: 'youtube' });
      if (item.superchat) {
        const dollars = parseFloat(String(item.superchat.amount).replace(/[^0-9.]/g, '')) || 1;
        // Rough conversion so Super Chats weigh like TikTok gifts in votes and power-ups
        send({ kind: 'gift', user, nick: item.author.name, gift: 'Super Chat', coins: Math.round(dollars * 75), count: 1, platform: 'youtube' });
        log(`YouTube Super Chat: ${item.author.name} ${item.superchat.amount}`);
      }
    });
    chat.on('end', () => { log('YouTube Live ended. Checking again in 60 seconds.'); setTimeout(run, 60000); });
    chat.on('error', e => log('YouTube chat error:', (e && e.message) || e));
    const ok = await chat.start().catch(() => false);
    if (ok) log('Connected to YouTube Live chat.');
    else { log('YouTube Live not found yet. Checking again in 60 seconds.'); setTimeout(run, 60000); }
  };
  run();
}

startTikTok().catch(e => log('TikTok module failed to load:', e.message, '. Run INSTALL-HOOPSHYPE-QUIZ.bat first.'));
startYouTube();
