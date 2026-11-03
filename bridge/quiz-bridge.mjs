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
// PRACTICE-HOOPSHYPE-QUIZ.bat starts the bridge with "practice": fake chat only, no TikTok connection
const PRACTICE = process.argv.slice(2).includes('practice');

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
// Scores that carry over between streams (champions, weekly board, teams, supporters) live in a file
// in this folder, so they survive closing the quiz window. Practice mode uses its own file.
const STATE_DIR = path.join(ROOT, 'saved');
const CARD_DIR = path.join(ROOT, 'recap-cards');
fs.mkdirSync(STATE_DIR, { recursive: true });
// Look settings (which layout) are shared by practice and live, so a look picked in practice is used on the LIVE
const settingsFile = path.join(STATE_DIR, 'quiz-settings.json');
const stateFile = practice => path.join(STATE_DIR, practice ? 'practice-state.json' : 'hoopshype-quiz-state.json');
function readBody(req, limit, cb) {
  const chunks = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > limit) req.destroy(); else chunks.push(c); });
  req.on('end', () => cb(Buffer.concat(chunks).toString('utf8')));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/state') {
    const file = stateFile(url.searchParams.has('practice'));
    if (req.method === 'POST') {
      return readBody(req, 5e6, body => {
        try {
          JSON.parse(body);                       // only ever write valid JSON
          fs.writeFileSync(file + '.tmp', body);
          fs.renameSync(file + '.tmp', file);     // atomic swap: a crash never leaves half a file
          res.writeHead(204); res.end();
        } catch (e) { res.writeHead(400); res.end(); }
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(fs.existsSync(file) ? fs.readFileSync(file) : '{}');
  }
  if (url.pathname === '/settings') {
    if (req.method === 'POST') {
      return readBody(req, 1e5, body => {
        try { JSON.parse(body); fs.writeFileSync(settingsFile, body); res.writeHead(204); res.end(); }
        catch (e) { res.writeHead(400); res.end(); }
      });
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile) : '{}');
  }
  if (url.pathname === '/card' && req.method === 'POST') {
    // Recap card PNG from the quiz page: { name, png (base64) }
    return readBody(req, 2e7, body => {
      try {
        const { name, png, txt } = JSON.parse(body);
        const safe = String(name).replace(/[^a-z0-9._-]/gi, '-').slice(0, 120);
        if (!/\.(png|txt)$/.test(safe)) throw new Error('bad name');
        const dir = url.searchParams.has('practice') ? path.join(CARD_DIR, 'practice') : CARD_DIR;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, safe), txt != null ? String(txt) : Buffer.from(png, 'base64'));
        log(`Recap card saved: ${path.join(dir, safe)}`);
        res.writeHead(204); res.end();
      } catch (e) { res.writeHead(400); res.end(); }
    });
  }
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
  if (PRACTICE) log('Practice mode: fake chat, gifts and likes. Not connecting to TikTok.');
  else log(`Practice mode (fake chat, no TikTok needed): http://localhost:${PORT}/?practice=1`);
});
setInterval(() => { for (const res of clients) res.write(': keep-alive\n\n'); }, 20000);

// ------------------------------------------------------------------ TikTok LIVE
async function startTikTok() {
  const user = String(cfg.tiktokUsername || '').replace(/^@/, '').trim();
  if (!user) { log('No tiktokUsername in config.json, TikTok chat is off.'); return; }
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await import('tiktok-live-connector');
  log(`Watching the TikTok account @${user}. Chat connects by itself once that account goes LIVE.`);
  let offlineLogged = 0;
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
    conn.on(ControlEvent.ERROR, e => {
      const m = String((e && (e.message || e.info)) || e);
      if (!/Room ID|Error while connecting|offline/i.test(m)) log('TikTok error:', m);   // "not LIVE yet" is reported once below
    });

    try {
      const st = await conn.connect();
      log(`Connected to @${user}'s LIVE (room ${st.roomId}). Chat, gifts and likes are flowing.`);
      status(true, 'Connected');
    } catch (e) {
      const msg = (e && e.message) || String(e);
      // "Failed to retrieve Room ID" is what TikTok answers when the account has no LIVE running right now
      const offline = /offline|not live|LIVE has ended|Room ID/i.test(msg) || (e && e.constructor && /UserOffline/.test(e.constructor.name));
      if (offline) {
        // say it plainly once, then only every 5 minutes, instead of an error every 20 seconds
        if (Date.now() - offlineLogged > 5 * 60 * 1000) {
          offlineLogged = Date.now();
          log(`@${user} is not LIVE right now. This is normal before you go LIVE: the quiz keeps checking every 20 seconds and connects by itself.`);
          log(`If you ARE live and this keeps showing, the username in config.json is wrong (it says "${user}").`);
        }
        status(false, 'Waiting for the TikTok LIVE to start...');
        retry(20);
      } else {
        log('Could not connect to TikTok yet:', msg, '. Retrying in 30 seconds.');
        status(false, 'Connecting to chat...');
        retry(30);
      }
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

if (!PRACTICE) {
  startTikTok().catch(e => log('TikTok chat reader failed to load:', e.message, '. Delete the node_modules folder and double-click START-HOOPSHYPE-QUIZ.bat again.'));
  startYouTube();
}
