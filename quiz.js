/* HoopsHype NBA Quiz Live: game engine and screen.
   Events (chat, gifts, likes, follows, shares) arrive from the local bridge (bridge/quiz-bridge.mjs)
   over /events, or from the built-in practice simulator when the page is opened with ?practice=1.

   Operator keys (click the quiz window first): N = skip question, P = pause/resume,
   B = start a blitz round, M = sound on/off, R = reset stream scores. */
(() => {
'use strict';

// ------------------------------------------------------------------ config
const DEFAULTS = {
  imgBase: 'https://jsierrahoopshype.github.io/nba-headshots/players/headshots/face-fill-320/',
  questionsUrl: 'https://raw.githubusercontent.com/jsierrahoopshype/hoopshype-quiz-live/HEAD/data/questions.json',
  questionsPerGame: 8,
  battleSlot: 4,                       // a chat battle is dropped in as question #5 of every game
  times: { guess: 45, mc: 20, tf: 14, hl: 15, battle: 18, board: 75, closest: 25, reveal: 8, intro: 7, recap: 10, voteResult: 6 },
  blitzTimes: { guess: 25, mc: 10, tf: 8, hl: 8, battle: 10, board: 40, closest: 14 },
  points: { easy: 50, medium: 75, hard: 100, rank: [50, 30, 20], board: 40, battle: 20, follow: 25, share: 50, perCoin: 10, closest: [150, 100, 50], exact: 300 },
  afterFirstCorrect: 8,                // seconds left once somebody names the player
  likeGoal: 1500, likeGoalGrowth: 1.4,
  // The 4 theme-vote columns. Each is tied to one gift; every coin of that gift is one vote.
  // Names must match TikTok's gift names exactly. The bridge window prints every gift name it sees.
  themeGifts: ['Rose', 'Ice Cream Cone', 'GG', 'Finger Heart'],
  powerups: { hint: 30, double: 99, blitz: 199 },   // coin thresholds for any other gift
  blitzLength: 3,
  diffMix: { easy: 0.5, medium: 0.4, hard: 0.1 },
};
let CFG = DEFAULTS;
const params = new URLSearchParams(location.search);
const PRACTICE = params.has('practice');

// ------------------------------------------------------------------ utils
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const now = () => Date.now();
const rnd = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmt = n => Math.round(n).toLocaleString('en-US');
function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
// Does a chat message name this player? Exact, contained as whole words, or a small typo.
function nameMatch(text, accept) {
  const t = norm(text);
  if (!t) return false;
  for (const a of accept) {
    if (t === a) return true;
    if (a.length >= 4 && (' ' + t + ' ').includes(' ' + a + ' ')) return true;
    const tol = a.length >= 10 ? 2 : a.length >= 6 ? 1 : 0;
    if (tol && lev(t, a) <= tol) return true;
  }
  return false;
}
function acceptFor(name) {
  const n = norm(name), parts = n.split(' ');
  const acc = [n];
  if (parts.length > 1 && parts[parts.length - 1].length >= 4) acc.push(parts[parts.length - 1]);
  return acc;
}
function parseNumber(text, q) {
  const s = String(text).toLowerCase().replace(/\s/g, '');
  const m = s.match(/\$?(\d[\d.,]*)(k|m|million|millones)?/);
  if (!m) return null;
  let raw = m[1];
  if (/^\d{1,3}([.,]\d{3})+$/.test(raw)) raw = raw.replace(/[.,]/g, '');   // 28,289 or 28.289
  else raw = raw.replace(/,/g, '.');
  let v = parseFloat(raw);
  if (!isFinite(v)) return null;
  const unit = m[2];
  const inMillions = /million/i.test(q.sub || '');
  if (unit === 'k') v *= 1000;
  if (unit && unit.startsWith('m') && !inMillions) v *= 1e6;
  if (inMillions && v >= 100000) v = v / 1e6;
  return v;
}
// Photo only when one exists: never an empty circle. A photo that fails to load removes its own frame.
const photo = (f, cls = '') => f ? `<div class="photo ${cls}"><img src="${CFG.imgBase}${encodeURIComponent(f)}" alt="" onerror="this.parentNode.remove()"></div>` : '';
function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

// ------------------------------------------------------------------ sound (simple WebAudio blips, no files)
let audio = null, muted = false;
function beep(freq, dur = 0.12, type = 'sine', vol = 0.08) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(audio.destination); o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur); o.stop(audio.currentTime + dur);
  } catch (e) {}
}
const sfx = {
  correct: () => { beep(880, .1); setTimeout(() => beep(1320, .16), 90); },
  tick: () => beep(520, .05, 'square', .03),
  reveal: () => { beep(660, .12); setTimeout(() => beep(990, .2), 120); },
  gift: () => { beep(1046, .08, 'triangle'); setTimeout(() => beep(1568, .14, 'triangle'), 80); },
};

// ------------------------------------------------------------------ state
const S = {
  data: null, themes: [], used: new Set(store('hhq_used') || []),
  game: 0, theme: null, queue: [], qi: 0, q: null, phase: 'boot',
  tStart: 0, tEnd: 0, dur: 1, paused: false, pausedLeft: 0,
  answered: new Map(), correct: [], closest: new Map(), filled: [], battleVotes: [0, 0],
  gameScores: new Map(), streamScores: new Map(), gifters: new Map(store('hhq_gifters') || []),
  names: new Map(), streaks: new Map(),
  voteThemes: [], votes: [0, 0, 0, 0],
  mult: 1, multBy: null, qMult: 1, blitzLeft: 0, blitzQueued: 0,
  likes: 0, likeGoal: DEFAULTS.likeGoal, likeBase: 0,
  revealPlan: null, struck: new Set(), stats: null, connected: false, statusText: '',
};
const displayName = u => S.names.get(u) || u;
function addPoints(u, pts) {
  if (!pts) return;
  S.gameScores.set(u, (S.gameScores.get(u) || 0) + pts);
  S.streamScores.set(u, (S.streamScores.get(u) || 0) + pts);
}
const isTF = q => q.type === 'mc' && q.options.length === 2 && q.options[0] === 'True';

// ------------------------------------------------------------------ question picking
function pickQueue(theme) {
  const all = S.data.questions;
  const pool = all.filter(q => q.type !== 'battle' && (theme === 'Mixed' || q.theme === theme));
  let fresh = pool.filter(q => !S.used.has(q.id));
  if (fresh.length < CFG.questionsPerGame * 2) {           // theme exhausted: forget its history
    pool.forEach(q => S.used.delete(q.id)); fresh = pool.slice();
  }
  const byDiff = { easy: [], medium: [], hard: [] };
  shuffle(fresh).forEach(q => (byDiff[q.difficulty] || byDiff.medium).push(q));
  const out = [], typeCount = {};
  const cap = { board: 1, closest: 2 };
  let guard = 0;
  while (out.length < CFG.questionsPerGame && guard++ < 400) {
    const r = Math.random();
    const d = r < CFG.diffMix.easy ? 'easy' : r < CFG.diffMix.easy + CFG.diffMix.medium ? 'medium' : 'hard';
    const list = byDiff[d].length ? byDiff[d] : (byDiff.medium.length ? byDiff.medium : byDiff.easy.length ? byDiff.easy : byDiff.hard);
    if (!list.length) break;
    const idx = list.findIndex(q => (typeCount[q.type] || 0) < (cap[q.type] ?? 99) && (!out.length || out[out.length - 1].type !== q.type || guard > 200));
    if (idx < 0) { list.shift(); continue; }
    const q = list.splice(idx, 1)[0];
    typeCount[q.type] = (typeCount[q.type] || 0) + 1;
    out.push(q);
  }
  const battles = shuffle(all.filter(q => q.type === 'battle' && !S.used.has(q.id)));
  if (battles.length && out.length > CFG.battleSlot) out.splice(CFG.battleSlot, 0, battles[0]);
  return out;
}
function markUsed(q) { S.used.add(q.id); store('hhq_used', [...S.used].slice(-4000)); }
function rollVoteThemes() {
  const options = shuffle(S.themes.filter(t => t !== S.theme));
  S.voteThemes = options.slice(0, 3).concat(S.theme === 'Mixed' ? [options[3]] : ['Mixed']);
  S.votes = [0, 0, 0, 0];
  renderVote();
}

// ------------------------------------------------------------------ game flow
function setPhase(p, secs) { S.phase = p; S.tStart = now(); S.dur = secs * 1000; S.tEnd = S.tStart + S.dur; S._lastTick = null; }
function startGame(theme) {
  S.game += 1;
  S.theme = theme;
  S.queue = pickQueue(theme);
  S.qi = 0; S.q = null;
  S.gameScores = new Map();
  S.stats = { answers: 0, players: new Set(), fastest: null, coins: 0 };
  rollVoteThemes();
  setPhase('intro', CFG.times.intro);
  renderIntro();
}
function nextQuestion() {
  if (S.qi >= S.queue.length) return endGame();
  const q = S.queue[S.qi];
  S.q = q; S.answered = new Map(); S.correct = []; S.closest = new Map(); S.struck = new Set();
  S.filled = q.slots ? q.slots.map(() => null) : [];
  S.battleVotes = [0, 0];
  if (S.blitzQueued && !S.blitzLeft) { S.blitzLeft = S.blitzQueued; S.blitzQueued = 0; addAlert('<b>BLITZ ROUND</b>: double points, half the time'); }
  const blitz = S.blitzLeft > 0;
  const tType = isTF(q) ? 'tf' : q.type;
  const secs = (blitz ? CFG.blitzTimes[tType] : null) || CFG.times[tType] || 20;
  S.qMult = (blitz ? 2 : 1) * S.mult;
  setPhase('question', secs);
  planReveals(q, secs);
  renderQuestion();
  preload(S.queue[S.qi + 1]);
}
function endQuestion() {
  const q = S.q;
  markUsed(q);
  if (q.type === 'mc' || q.type === 'hl') scoreChoice(q);
  if (q.type === 'closest') scoreClosest(q);
  if (q.type === 'battle') scoreBattle(q);
  if (S.blitzLeft > 0) S.blitzLeft -= 1;
  if (S.mult > 1) { S.mult = 1; S.multBy = null; }
  setPhase('reveal', CFG.times.reveal);
  sfx.reveal();
  renderReveal();
}
function endGame() { setPhase('recap', CFG.times.recap); renderRecap(); }
function afterRecap() {
  let best = -1, idx = 0;
  S.votes.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  S.nextTheme = best > 0 ? S.voteThemes[idx] : rnd(S.voteThemes);
  setPhase('voteResult', CFG.times.voteResult);
  renderVoteResult(S.nextTheme, best);
}
function tick() {
  if (S.paused || !S.data) return;
  const left = S.tEnd - now();
  updateClock(left);
  if (S.phase === 'question') {
    progressiveReveal();
    const sec = Math.ceil(left / 1000);
    if (left <= 5000 && left > 0 && sec !== S._lastTick) { S._lastTick = sec; sfx.tick(); }
  }
  if (left > 0) return;
  if (S.phase === 'intro') nextQuestion();
  else if (S.phase === 'question') endQuestion();
  else if (S.phase === 'reveal') { S.qi += 1; nextQuestion(); }
  else if (S.phase === 'recap') afterRecap();
  else if (S.phase === 'voteResult') startGame(S.nextTheme);
}

// ------------------------------------------------------------------ letter reveal plan
function planReveals(q, secs) {
  S.revealPlan = null;
  if (q.type !== 'guess') return;
  const letters = [];
  [...q.answer].forEach((c, i) => { if (/[a-z0-9]/i.test(c)) letters.push(i); });
  const order = shuffle(letters.slice()).slice(0, Math.floor(letters.length * 0.45));
  const startClues = q.clues.length >= 4 ? 2 : 1;
  const extra = q.clues.length - startClues;
  const T = secs * 1000;
  S.revealPlan = {
    shownLetters: new Set(),
    letterTimes: order.map((idx, i) => ({ idx, at: T * (0.2 + 0.75 * (i + 1) / (order.length + 1)) })),
    clueTimes: Array.from({ length: extra }, (_, i) => T * (0.08 + 0.6 * (i + 1) / (extra + 1))),
    shownClues: startClues, total: letters.length, zoom: q.imageMode === 'zoom',
  };
}
function progressiveReveal() {
  const P = S.revealPlan;
  if (!P) return;
  const t = now() - S.tStart;
  let changed = false;
  while (P.clueTimes.length && t >= P.clueTimes[0]) { P.clueTimes.shift(); P.shownClues++; changed = true; }
  while (P.letterTimes.length && t >= P.letterTimes[0].at) { P.shownLetters.add(P.letterTimes.shift().idx); changed = true; }
  if (changed) renderGuess();
  if (P.zoom) {
    const i = $('.zoombox img');
    if (i) i.style.transform = `scale(${(3.4 - 2.4 * Math.min(1, t / (S.dur * 0.85))).toFixed(3)})`;
  }
}
function hintNow(by) {
  const q = S.q;
  if (S.phase !== 'question' || !q) return;
  if (q.type === 'guess' && S.revealPlan) {
    const P = S.revealPlan;
    if (P.clueTimes.length) { P.clueTimes.shift(); P.shownClues++; }
    if (P.letterTimes.length) P.shownLetters.add(P.letterTimes.shift().idx);
    renderGuess();
    addAlert(`<b>${esc(by)}</b> unlocked a hint for everyone`);
  } else if (q.type === 'mc' && q.options.length > 2) {
    const wrong = q.options.map((_, i) => i).filter(i => i !== q.correct && !S.struck.has(i));
    if (wrong.length > 1) { S.struck.add(rnd(wrong)); renderQuestion(true); }
    addAlert(`<b>${esc(by)}</b> knocked out a wrong answer`);
  } else if (q.type === 'board') {
    const open = S.filled.map((f, i) => f ? null : i).filter(i => i != null);
    if (open.length) { S.filled[rnd(open)] = { u: null, hint: true }; renderQuestion(true); }
    addAlert(`<b>${esc(by)}</b> revealed a name on the board`);
  } else {
    S.tEnd += 8000; S.dur += 8000;
    addAlert(`<b>${esc(by)}</b> added 8 seconds`);
  }
}

// ------------------------------------------------------------------ answers
function onChat(u, text) {
  if (S.stats) S.stats.players.add(u);
  const q = S.q;
  if (S.phase !== 'question' || !q || S.paused) return;
  if (q.type === 'guess') return answerGuess(q, u, text);
  if (q.type === 'mc') return answerChoice(q, u, choiceIndex(q, text));
  if (q.type === 'hl' || q.type === 'battle') return answerChoice(q, u, sideIndex(q, text));
  if (q.type === 'board') return answerBoard(q, u, text);
  if (q.type === 'closest') return answerClosest(q, u, text);
}
function choiceIndex(q, text) {
  const t = norm(text);
  if (isTF(q)) {
    if (['true', 't', 'yes', 'si', 'v', 'verdadero'].includes(t)) return 0;
    if (['false', 'f', 'no', 'falso'].includes(t)) return 1;
    return null;
  }
  const m = t.match(/^(?:option )?([abcd1-4])$/);
  if (m) return { a: 0, b: 1, c: 2, d: 3, '1': 0, '2': 1, '3': 2, '4': 3 }[m[1]];
  for (let i = 0; i < q.options.length; i++) {
    const o = norm(q.options[i]);
    if (t === o || (/[a-z]/.test(o) && nameMatch(text, acceptFor(q.options[i])))) return i;
  }
  return null;
}
function sideIndex(q, text) {
  const t = norm(text);
  if (['a', '1'].includes(t)) return 0;
  if (['b', '2'].includes(t)) return 1;
  for (let i = 0; i < 2; i++) if (nameMatch(text, acceptFor(q.sides[i].name))) return i;
  return null;
}
const basePoints = q => (CFG.points[q.difficulty] || 60) * (S.qMult || 1);
function answerGuess(q, u, text) {
  if (S.correct.some(c => c.u === u) || !nameMatch(text, q.accept)) return;
  const P = S.revealPlan;
  const frac = P && P.total ? P.shownLetters.size / P.total : 0;
  const rank = S.correct.length;
  registerCorrect(u, Math.round(basePoints(q) * (1 - 0.5 * frac)) + (CFG.points.rank[rank] || 0) * (S.qMult || 1));
  if (rank === 0) S.tEnd = Math.min(S.tEnd, now() + CFG.afterFirstCorrect * 1000);
}
function answerChoice(q, u, idx) {
  if (idx == null || S.answered.has(u)) return;      // first answer counts: no spamming every option
  if (q.type === 'mc' && S.struck.has(idx)) return;
  S.answered.set(u, { idx, at: now() });
  S.stats.answers++;
  if (q.type === 'battle') S.battleVotes[idx]++;
  renderLive();
}
function scoreChoice(q) {
  const right = [...S.answered.entries()].filter(([, a]) => a.idx === q.correct).sort((a, b) => a[1].at - b[1].at);
  right.forEach(([u], rank) => registerCorrect(u, basePoints(q) + (CFG.points.rank[rank] || 0) * (S.qMult || 1), true));
  [...S.answered.entries()].filter(([, a]) => a.idx !== q.correct).forEach(([u]) => S.streaks.set(u, 0));
}
function scoreBattle() {
  const [a, b] = S.battleVotes;
  S.battleWin = a === b ? -1 : (a > b ? 0 : 1);
  if (S.battleWin < 0) return;
  const pts = CFG.points.battle * (S.qMult || 1);
  [...S.answered.entries()].filter(([, x]) => x.idx === S.battleWin).forEach(([u]) => { addPoints(u, pts); S.correct.push({ u, pts }); });
}
function answerBoard(q, u, text) {
  let hit = false;
  q.slots.forEach((s, i) => { if (!S.filled[i] && nameMatch(text, s.accept)) { S.filled[i] = { u }; hit = true; } });
  if (!hit) return;
  const pts = CFG.points.board * (S.qMult || 1);
  addPoints(u, pts);
  const prev = S.correct.find(c => c.u === u);
  if (prev) prev.pts += pts; else S.correct.push({ u, pts });
  S.stats.answers++;
  sfx.correct();
  setEvent(`<b>${esc(displayName(u))}</b> found one, +${pts}`);
  renderQuestion(true);
  renderBoards();
  if (S.filled.every(Boolean)) S.tEnd = Math.min(S.tEnd, now() + 2500);
}
function answerClosest(q, u, text) {
  const v = parseNumber(text, q);
  if (v == null) return;
  if (!S.closest.has(u)) S.stats.answers++;
  S.closest.set(u, { v, at: now() });
  renderLive();
}
function scoreClosest(q) {
  const rows = [...S.closest.entries()].map(([u, a]) => ({ u, v: a.v, d: Math.abs(a.v - q.value), at: a.at }))
    .sort((a, b) => a.d - b.d || a.at - b.at).slice(0, 3);
  rows.forEach((r, i) => {
    r.pts = (r.d === 0 ? CFG.points.exact : CFG.points.closest[i]) * (S.qMult || 1);
    addPoints(r.u, r.pts); S.correct.push({ u: r.u, pts: r.pts });
  });
  S.closestRows = rows;
}
function registerCorrect(u, pts, quiet) {
  addPoints(u, pts);
  S.streaks.set(u, (S.streaks.get(u) || 0) + 1);
  S.correct.push({ u, pts, at: now() });
  if (!quiet) S.stats.answers++;
  if (S.correct.length === 1) {
    const secs = (now() - S.tStart) / 1000;
    if (!S.stats.fastest || secs < S.stats.fastest.s) S.stats.fastest = { u, s: secs };
    if (!quiet) { sfx.correct(); setEvent(`<b>${esc(displayName(u))}</b> got it first, +${pts}. Still time to answer`); }
  } else if (!quiet) setEvent(`<b>${esc(displayName(u))}</b> got it too, +${pts}. ${S.correct.length} correct so far`);
  renderBoards();
}

// ------------------------------------------------------------------ gifts, likes, social
function onGift(ev) {
  const u = ev.user, total = (ev.coins || 1) * (ev.count || 1);
  S.names.set(u, ev.nick || u);
  S.gifters.set(u, (S.gifters.get(u) || 0) + total);
  store('hhq_gifters', [...S.gifters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200));
  if (S.stats) S.stats.coins += total;
  addPoints(u, total * CFG.points.perCoin);
  sfx.gift();
  const who = `<b>${esc(displayName(u))}</b>`;
  const col = CFG.themeGifts.findIndex(g => norm(g) === norm(ev.gift));
  if (col >= 0 && S.voteThemes[col]) {
    S.votes[col] += total;
    renderVote();
    addAlert(`${who} voted ${esc(S.voteThemes[col])} (+${total})`);
  } else if (total >= CFG.powerups.blitz) {
    S.blitzQueued = CFG.blitzLength;
    addAlert(`${who} called a BLITZ ROUND`);
  } else if (total >= CFG.powerups.double) {
    S.mult = 2; S.multBy = displayName(u);
    addAlert(`${who} made the next question DOUBLE POINTS`);
  } else if (total >= CFG.powerups.hint) {
    if (S.phase === 'question') hintNow(displayName(u)); else addAlert(`Thanks ${who} for the ${esc(ev.gift)}`);
  } else {
    addAlert(`Thanks ${who} for the ${esc(ev.gift)}${ev.count > 1 ? ' x' + ev.count : ''}`);
  }
  renderBoards(); renderThemebar();
}
function onLikes(n, total) {
  S.likes = total != null ? Math.max(S.likes, total) : S.likes + n;
  if (S.likes - S.likeBase >= S.likeGoal) {
    S.likeBase = S.likes;
    S.likeGoal = Math.round(S.likeGoal * CFG.likeGoalGrowth / 100) * 100;
    S.blitzQueued = CFG.blitzLength;
    addAlert('<b>LIKE GOAL HIT</b>: blitz round coming, double points');
  }
  renderLikes();
}
function onSocial(kind, u) {
  const pts = kind === 'share' ? CFG.points.share : CFG.points.follow;
  addPoints(u, pts);
  addAlert(`<b>${esc(displayName(u))}</b> ${kind === 'share' ? 'shared the LIVE' : 'followed'}, +${pts} points`);
  renderBoards();
}
function onEvent(ev) {
  if (ev.user && ev.nick) S.names.set(ev.user, ev.nick);
  switch (ev.kind) {
    case 'chat': onChat(ev.user, ev.text); break;
    case 'gift': onGift(ev); break;
    case 'like': onLikes(ev.count || 1, ev.total); break;
    case 'follow': case 'share': onSocial(ev.kind, ev.user); break;
    case 'status': S.connected = !!ev.connected; S.statusText = ev.text || ''; break;
  }
}

// ------------------------------------------------------------------ screen: chrome
const body = () => $('#panel-body');
function renderThemebar() {
  $('#gameno').textContent = S.game ? `GAME ${S.game}` : '';
  let tag = '';
  if (S.phase === 'question' || S.phase === 'reveal') {
    if (S.blitzLeft > 0) tag = '<span class="tag">BLITZ</span>';
    else if (S.qMult > 1) tag = '<span class="tag">DOUBLE POINTS</span>';
  }
  $('#theme-name').innerHTML = esc(S.theme || '') + tag;
  const pips = S.queue.map((q, i) => {
    const st = S.phase === 'recap' || S.phase === 'voteResult' || i < S.qi ? 'done' : (i === S.qi && S.phase !== 'intro') ? 'now' : '';
    return `<span class="pip ${st}${q.type === 'battle' ? ' battle' : ''}"></span>`;
  }).join('');
  $('#pips').innerHTML = pips;
}
function setInstruction(text, mode = 'go') {
  const el = $('#instruction');
  el.className = mode === 'go' ? '' : mode;
  $('#instr-text').textContent = text;
}
function updateClock(left) {
  const showClock = ['question', 'intro', 'recap'].includes(S.phase);
  const secs = Math.max(0, Math.ceil(left / 1000));
  $('#clock').textContent = !showClock ? '' : S.paused ? 'II' : String(secs);
  const frac = S.dur ? Math.max(0, Math.min(1, left / S.dur)) : 0;
  $('#timefill').style.width = (showClock ? frac * 100 : 0) + '%';
  const low = S.phase === 'question' && secs <= 5;
  $('#timebar').classList.toggle('low', low);
  $('#instruction').classList.toggle('low', low);
}
let eventDefault = '';
function setEvent(html) { eventDefault = html; if (!alertBusy) paintEvent(html, false); }
function paintEvent(html, alert) { const e = $('#eventline'); e.innerHTML = html ? `<span>${html}</span>` : ''; e.classList.toggle('alert', alert); }
const alertQ = [];
let alertBusy = false;
function addAlert(html) { alertQ.push(html); if (alertQ.length > 6) alertQ.shift(); if (!alertBusy) nextAlert(); }
function nextAlert() {
  if (!alertQ.length) { alertBusy = false; paintEvent(eventDefault, false); return; }
  alertBusy = true;
  paintEvent(alertQ.shift(), true);
  setTimeout(nextAlert, 3000);
}

// ------------------------------------------------------------------ screen: panels
const THEME_DESC = {
  'Career Paths': 'We list the teams. You name the player.',
  'Stat Lines': 'A real season stat line. Whose was it?',
  'Draft & Bio': 'Draft nights, colleges and hometowns.',
  'Awards & Rings': 'MVPs, Finals MVPs, rings and All-Star picks.',
  'Record Book': 'All-time and active career leaders.',
  'Money Talks': 'Salaries and career earnings.',
  'Jersey Kings': 'The NBA\'s best-selling jerseys.',
  'Around the World': 'The league\'s international stars.',
  'Name the Face': 'The photo zooms out. Name him first.',
  'Franchise Legends': 'Every team\'s top scorers since 2000-01.',
  'Mixed': 'A bit of everything.',
};
function renderIntro() {
  renderThemebar();
  body().innerHTML = `<div class="big-center"><div class="title">${esc(S.theme)}</div><div class="desc">${esc(THEME_DESC[S.theme] || '')}</div></div>
    <div class="rules">
      <div class="rule"><b>1</b>Type your answer in the chat</div>
      <div class="rule"><b>2</b>Fastest correct answer scores the most points</div>
      <div class="rule"><b>3</b>Send a theme's gift to pick the next game</div>
    </div>`;
  setInstruction(`${S.queue.length} questions. Starting in`, 'wait');
  setEvent(S.game > 1 ? 'Scores for this game reset. The stream leaderboard keeps counting' : 'Welcome. No sign-up, just type in the chat');
  renderBoards();
}
function instructionFor(q) {
  if (q.type === 'guess') return 'Type the player\'s name';
  if (q.type === 'mc') return isTF(q) ? 'Type TRUE or FALSE' : 'Type A, B, C or D';
  if (q.type === 'hl') return 'Type A or B';
  if (q.type === 'battle') return 'Vote: type A or B';
  if (q.type === 'board') return 'Type as many names as you can';
  if (q.type === 'closest') return 'Type a number. Closest wins';
  return 'Type your answer';
}
function promptHtml(q) {
  return `<div class="prompt${q.prompt.length > 46 ? ' long' : ''}">${esc(q.prompt)}</div>` + (q.sub ? `<div class="sub">${esc(q.sub)}</div>` : '');
}
function renderQuestion(keepEvent) {
  renderThemebar();
  const q = S.q;
  setInstruction(instructionFor(q));
  if (!keepEvent) setEvent(q.type === 'battle' ? 'No wrong answers. Everyone on the winning side scores'
    : q.type === 'board' ? `${CFG.points.board * (S.qMult || 1)} points for every name you find`
    : q.type === 'closest' ? 'Your last number counts. Top 3 closest score'
    : q.type === 'guess' ? 'Clues and letters appear as the clock runs down'
    : `Your first answer counts. Worth ${basePoints(q)} points`);
  if (q.type === 'guess') return renderGuess();
  let h = '';
  if (q.type === 'mc') {
    h += q.image ? `<div class="row-head">${photo(q.image, 'sm')}${promptHtml(q)}</div>` : promptHtml(q);
    h += '<div class="opts">' + q.options.map((o, i) => `<div class="opt${S.struck.has(i) ? ' struck' : ''}"><span class="k">${isTF(q) ? (i ? 'F' : 'T') : 'ABCD'[i]}</span><span class="t">${esc(o)}</span></div>`).join('') + '</div>';
  } else if (q.type === 'hl' || q.type === 'battle') {
    h += promptHtml(q) + vsHtml(q, false);
  } else if (q.type === 'board') {
    h += promptHtml(q) + slotsHtml(q, false) + `<div class="found">${S.filled.filter(Boolean).length} of ${q.slots.length} found</div>`;
  } else if (q.type === 'closest') {
    h += q.image ? `<div class="row-head">${photo(q.image, 'sm')}<div style="flex:1">${promptHtml(q)}</div></div>` : promptHtml(q);
    h += `<div class="closest-body"><div class="guesscount" id="gcount">0<small>guesses</small></div></div>`;
  }
  body().innerHTML = h;
  renderLive();
}
function vsHtml(q, reveal) {
  const t = S.battleVotes[0] + S.battleVotes[1];
  const sides = q.sides.map((s, i) => {
    let cls = '';
    if (reveal && q.type === 'hl') cls = i === q.correct ? ' right' : ' fade';
    if (reveal && q.type === 'battle' && S.battleWin >= 0) cls = i === S.battleWin ? ' right' : ' fade';
    const val = q.type === 'hl' ? `<div class="val${reveal ? '' : ' hide'}">${reveal ? esc(s.value) : '?'}</div>` : '';
    const meta = q.type === 'battle' ? `<div class="meta">${esc(s.value || '')}</div>` : '';
    return `<div class="side${cls}"><div class="k">${'AB'[i]}</div>${photo(s.img)}<div class="nm">${esc(s.name)}</div>${val}${meta}</div>`;
  }).join('');
  let split = '';
  if (q.type === 'battle') {
    const pa = t ? Math.round(100 * S.battleVotes[0] / t) : 50;
    split = `<div class="split"><div class="a" id="split-a" style="width:${pa}%">A ${t ? pa + '%' : ''}</div><div class="b" id="split-b">${t ? (100 - pa) + '%' : ''} B</div></div>`;
  }
  return `<div class="vs">${sides}</div>${split}`;
}
function slotsHtml(q, reveal) {
  const one = q.slots.length <= 5 ? ' one' : '';
  return `<div class="slots${one}">` + q.slots.map((s, i) => {
    const f = S.filled[i];
    if (f) return `<div class="slot got"><span class="lab">${esc(s.label)}</span>${photo(s.img, 'xs')}<span><div class="who">${esc(s.name)}</div><div class="by">${f.hint ? 'gift hint' : esc(displayName(f.u))}</div></span></div>`;
    if (reveal) return `<div class="slot miss"><span class="lab">${esc(s.label)}</span>${photo(s.img, 'xs')}<span><div class="who">${esc(s.name)}</div><div class="by">missed</div></span></div>`;
    return `<div class="slot"><span class="lab">${esc(s.label)}</span><span class="blank"></span></div>`;
  }).join('') + '</div>';
}
function renderGuess() {
  const q = S.q, P = S.revealPlan;
  if (!q || q.type !== 'guess' || S.phase !== 'question') return;
  const shown = P ? P.shownClues : q.clues.length;
  let h = promptHtml(q);
  const zoom = q.imageMode === 'zoom' && q.image;
  if (zoom) h += `<div class="zoombox"><img src="${CFG.imgBase}${encodeURIComponent(q.image)}" alt=""></div>`;
  h += `<div class="clues${zoom ? ' compact' : ''}">` + q.clues.map((c, i) => i < shown
    ? `<div class="clue"><span class="n">${i + 1}</span><span>${esc(c)}</span></div>`
    : `<div class="clue locked"><span class="n">${i + 1}</span><span>Unlocks soon</span></div>`).join('') + '</div>';
  const letters = q.answer.replace(/ /g, '').length;
  let pos = 0;
  h += `<div class="letters${letters > 14 ? ' small' : ''}">` + q.answer.split(' ').map(w => {
    const tiles = [...w].map(ch => {
      const i = pos++;
      if (!/[a-z0-9]/i.test(ch)) return `<span class="tile p">${esc(ch)}</span>`;
      const on = P && P.shownLetters.has(i);
      return `<span class="tile${on ? ' on' : ''}">${on ? esc(ch.toUpperCase()) : ''}</span>`;
    }).join('');
    pos++;
    return `<span class="word">${tiles}</span>`;
  }).join('') + '</div>';
  const old = body().querySelector('.zoombox img');
  const keep = old ? old.style.transform : '';
  body().innerHTML = h;
  const z = body().querySelector('.zoombox img');
  if (z && keep) z.style.transform = keep;
  if (z) z.onerror = () => z.parentNode.remove();
}
function renderLive() {
  const q = S.q;
  if (!q || S.phase !== 'question') return;
  if ((q.type === 'mc' || q.type === 'hl') && S.answered.size) {
    if (!S.correct.length) setEvent(`<b>${S.answered.size}</b> answer${S.answered.size === 1 ? '' : 's'} locked in`);
  } else if (q.type === 'battle') {
    const [a, b] = S.battleVotes, t = a + b;
    const pa = t ? Math.round(100 * a / t) : 50;
    const A = $('#split-a'), B = $('#split-b');
    if (A) { A.style.width = pa + '%'; A.textContent = `A ${t ? pa + '%' : ''}`; B.textContent = `${t ? (100 - pa) + '%' : ''} B`; }
    if (t) setEvent(`<b>${t}</b> vote${t === 1 ? '' : 's'} so far`);
  } else if (q.type === 'closest') {
    const g = $('#gcount'); if (g) g.innerHTML = `${S.closest.size}<small>guess${S.closest.size === 1 ? '' : 'es'}</small>`;
  }
}
function winnersHtml(n = 3) {
  return '<div class="winners">' + S.correct.slice(0, n).map((c, i) =>
    `<div class="winner"><span class="r">${i + 1}</span><span class="u">${esc(displayName(c.u))}${(S.streaks.get(c.u) || 0) >= 3 ? ` (${S.streaks.get(c.u)} in a row)` : ''}</span><span class="p">+${c.pts}</span></div>`).join('') + '</div>';
}
function renderReveal() {
  renderThemebar();
  const q = S.q;
  let h = '';
  const nCorrect = S.correct.length;
  if (q.type === 'mc') {
    const counts = q.options.map((_, i) => [...S.answered.values()].filter(a => a.idx === i).length);
    const tot = counts.reduce((a, b) => a + b, 0) || 1;
    h += q.image ? `<div class="row-head">${photo(q.image, 'sm')}${promptHtml(q)}</div>` : promptHtml(q);
    h += '<div class="opts">' + q.options.map((o, i) => {
      const pct = Math.round(100 * counts[i] / tot);
      return `<div class="opt ${i === q.correct ? 'right' : 'fade'}"><div class="bar" style="width:calc(${pct}% - ${pct ? 0 : 0}px)"></div><span class="k">${isTF(q) ? (i ? 'F' : 'T') : 'ABCD'[i]}</span><span class="t">${esc(o)}</span><span class="pct">${counts.some(Boolean) ? pct + '%' : ''}</span></div>`;
    }).join('') + '</div>';
    setInstruction(`Answer: ${isTF(q) ? q.answer : 'ABCD'[q.correct] + ', ' + q.answer}`, 'answer');
    setEvent(nCorrect ? `<b>${nCorrect}</b> got it right. Fastest: <b>${esc(displayName(S.correct[0].u))}</b> +${S.correct[0].pts}` : 'Nobody got this one');
  } else if (q.type === 'hl') {
    h += promptHtml(q) + vsHtml(q, true);
    setInstruction(`Answer: ${'AB'[q.correct]}, ${q.answer}`, 'answer');
    setEvent(nCorrect ? `<b>${nCorrect}</b> got it right. Fastest: <b>${esc(displayName(S.correct[0].u))}</b> +${S.correct[0].pts}` : 'Nobody got this one');
  } else if (q.type === 'battle') {
    const t = S.battleVotes[0] + S.battleVotes[1];
    h += promptHtml(q) + vsHtml(q, true);
    if (S.battleWin >= 0) {
      setInstruction(`Chat picked ${q.sides[S.battleWin].name}`, 'answer');
      setEvent(`<b>${Math.round(100 * S.battleVotes[S.battleWin] / t)}%</b> of ${t} votes. Everyone on that side +${CFG.points.battle * (S.qMult || 1)}`);
    } else { setInstruction('It\'s a tie', 'answer'); setEvent(t ? `${t} votes, split down the middle` : 'No votes this time'); }
  } else if (q.type === 'board') {
    const got = S.filled.filter(f => f && !f.hint).length;
    h += promptHtml(q) + slotsHtml(q, true);
    setInstruction(`Chat found ${got} of ${q.slots.length}`, 'answer');
    const top = [...S.correct].sort((a, b) => b.pts - a.pts)[0];
    setEvent(top ? `Most found: <b>${esc(displayName(top.u))}</b> +${top.pts}` : 'Nobody found one this time');
  } else if (q.type === 'closest') {
    h += `<div class="ans-wrap">${photo(q.image)}<div><div class="ans-name">${esc(q.answer)}</div>${q.fact ? `<div class="ans-fact">${esc(q.fact)}</div>` : ''}<div class="ans-q">${esc(q.prompt)}</div></div></div>`;
    h += '<div class="cl-rows">' + (S.closestRows || []).map((r, i) => `<div class="cl-row"><span>${i + 1}. ${esc(displayName(r.u))} said ${fmt(r.v)}</span><span class="p">+${r.pts}</span></div>`).join('') + '</div>';
    if (!S.closestRows || !S.closestRows.length) h += '<div class="nobody">No guesses this time</div>';
    setInstruction(`The answer: ${q.answer}`, 'answer');
    setEvent(S.closestRows && S.closestRows.length ? `Closest: <b>${esc(displayName(S.closestRows[0].u))}</b> +${S.closestRows[0].pts}` : '');
  } else {   // guess
    const face = q.revealImage || q.image;
    h += `<div class="ans-wrap">${photo(face)}<div><div class="ans-name${q.answer.length > 16 ? ' mid' : ''}">${esc(q.answer)}</div>${q.fact ? `<div class="ans-fact">${esc(q.fact)}</div>` : ''}</div></div>`;
    h += nCorrect ? winnersHtml(4) : '<div class="nobody">Nobody got this one</div>';
    setInstruction(`The answer: ${q.answer}`, 'answer');
    setEvent(nCorrect ? `<b>${nCorrect}</b> named him` : '');
  }
  body().innerHTML = h;
  renderBoards();
}
function renderRecap() {
  renderThemebar();
  const st = S.stats, top = [...S.gameScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  let h = `<div class="prompt">${esc(S.theme)}: final scores</div>`;
  h += '<div class="recap-list winners" style="margin-top:26px">' + (top.length ? top.map(([u, v], i) =>
    `<div class="winner"><span class="r">${i + 1}</span><span class="u">${esc(displayName(u))}</span><span class="p">${fmt(v)}</span></div>`).join('')
    : '<div class="winner"><span class="u">No scores this game</span></div>') + '</div>';
  const facts = [`${fmt(st.answers)} answers from ${st.players.size} players`];
  if (st.fastest) facts.push(`Fastest answer: ${displayName(st.fastest.u)} in ${st.fastest.s.toFixed(1)}s`);
  h += `<div class="ans-fact" style="margin-top:auto">${facts.map(esc).join('<br>')}</div>`;
  body().innerHTML = h;
  setInstruction('Next theme locks in', 'go');
  setEvent(top.length ? `<b>${esc(displayName(top[0][0]))}</b> wins game ${S.game}` : '');
}
function renderVoteResult(theme, votes) {
  renderThemebar();
  body().innerHTML = `<div class="big-center"><div class="title">${esc(theme)}</div><div class="desc">${esc(THEME_DESC[theme] || '')}</div></div>`;
  setInstruction(`Up next: ${theme}`, 'wait');
  setEvent(votes > 0 ? `Picked by your gifts: <b>${fmt(votes)}</b> votes` : 'Picked at random. Send a gift to choose the next one');
}
function renderVote() {
  const max = Math.max(...S.votes);
  $('#vote-cols').innerHTML = S.voteThemes.map((t, i) => `<div class="vc${max > 0 && S.votes[i] === max ? ' lead' : ''}">
    <div class="top"><span class="gift">${esc(CFG.themeGifts[i] || '')}</span><span class="n">${S.votes[i]}</span></div><div class="th">${esc(t)}</div></div>`).join('');
}
function renderBoards() {
  const fill = (sel, entries) => {
    const rows = entries.slice(0, 4);
    $(sel).innerHTML = rows.length ? rows.map(([u, v], i) => `<li><span class="u">${i + 1}. ${esc(displayName(u))}</span><span class="s">${fmt(v)}</span></li>`).join('')
      : '<li class="empty">Nobody yet</li>';
  };
  fill('#lb-stream', [...S.streamScores.entries()].sort((a, b) => b[1] - a[1]));
  fill('#lb-gift', [...S.gifters.entries()].sort((a, b) => b[1] - a[1]));
}
function renderLikes() {
  const got = S.likes - S.likeBase;
  $('#likefill').style.width = Math.min(100, 100 * got / S.likeGoal) + '%';
  $('#liketext').textContent = `Tap likes: ${fmt(got)} / ${fmt(S.likeGoal)} unlocks a blitz round`;
}
function preload(q) {
  if (!q) return;
  [q.image, q.revealImage, ...(q.sides || []).map(s => s.img), ...(q.slots || []).map(s => s.img)]
    .filter(Boolean).forEach(f => { const i = new Image(); i.src = CFG.imgBase + encodeURIComponent(f); });
}
function fit() {
  const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  const st = $('#stage');
  st.style.transform = `scale(${s})`;
  st.style.left = ((window.innerWidth - 1080 * s) / 2) + 'px';
  st.style.top = ((window.innerHeight - 1920 * s) / 2) + 'px';
}

// ------------------------------------------------------------------ live events from the bridge
function connectBridge() {
  const open = () => {
    let es;
    try { es = new EventSource('/events'); } catch (e) { return setTimeout(open, 3000); }
    es.onmessage = m => { try { onEvent(JSON.parse(m.data)); } catch (e) {} };
    es.onerror = () => { S.connected = false; S.statusText = 'Quiz bridge not running: start it with START-HOOPSHYPE-QUIZ.bat'; es.close(); setTimeout(open, 3000); };
  };
  open();
  // While the chat isn't connected, say so in the like bar instead of hiding it
  setInterval(() => { if (!S.connected) $('#liketext').textContent = S.statusText || 'Connecting to chat...'; else renderLikes(); }, 3000);
}

// ------------------------------------------------------------------ practice simulator (fake chat, gifts, likes)
function startPractice() {
  S.connected = true;
  const bots = ['hoopsfan23', 'Lakeshow4L', 'bucketsgetter', 'mamba_mentality', 'jokicmagic', 'Celtics_17', 'curryrange30',
    'dunkcity', 'goatdebate', 'NBAnerd', 'courtvision', 'ballislife', 'triple_double', 'splash_bro', 'thunderup', 'mavsfan41',
    'heatculture', 'knicksknation', 'okc_boomer', 'spursway21', 'rim_protector', 'stepbackthree', 'fastbreak', 'hoopdreams'];
  const gifts = [['Rose', 1], ['Ice Cream Cone', 1], ['GG', 1], ['Finger Heart', 5], ['Doughnut', 30], ['Hand Hearts', 100], ['Hat and Mustache', 99], ['Corgi', 299]];
  const skill = { easy: 0.55, medium: 0.35, hard: 0.15 };
  const say = (u, text) => onEvent({ kind: 'chat', user: u, nick: u, text });
  setInterval(() => {
    const u = rnd(bots), q = S.q;
    if (S.phase !== 'question' || !q) { if (Math.random() < 0.3) say(u, rnd(['lets go', 'gg', 'next one', 'hi from Madrid'])); return; }
    const right = Math.random() < (skill[q.difficulty] || 0.35) * (0.4 + (now() - S.tStart) / S.dur);
    if (q.type === 'guess') say(u, right ? q.answer : rnd(['LeBron', 'Kobe Bryant', 'Tim Duncan', 'Chris Paul', 'idk']));
    else if (q.type === 'mc') say(u, isTF(q) ? (right === (q.correct === 0) ? 'true' : 'false') : (right ? 'ABCD'[q.correct] : rnd(['A', 'B', 'C', 'D'])));
    else if (q.type === 'hl') say(u, right ? 'AB'[q.correct] : rnd(['A', 'B']));
    else if (q.type === 'battle') say(u, Math.random() < 0.6 ? 'A' : 'B');
    else if (q.type === 'board') { const s = rnd(q.slots); say(u, right ? s.name.split(' ').slice(-1)[0] : rnd(['Shaq', 'Kobe', 'Iverson'])); }
    else if (q.type === 'closest') say(u, String(Math.round(q.value * (0.7 + Math.random() * 0.6))));
  }, 450);
  setInterval(() => {
    if (Math.random() < 0.35) { const [g, c] = rnd(gifts); onEvent({ kind: 'gift', user: rnd(bots), gift: g, coins: c, count: c === 1 ? 1 + Math.floor(Math.random() * 5) : 1 }); }
    onEvent({ kind: 'like', count: 20 + Math.floor(Math.random() * 60) });
    if (Math.random() < 0.08) onEvent({ kind: rnd(['follow', 'share']), user: rnd(bots) });
  }, 2500);
}

// ------------------------------------------------------------------ operator keys
window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'n' && S.phase === 'question') S.tEnd = now();
  if (k === 'p') {
    S.paused = !S.paused;
    if (S.paused) S.pausedLeft = S.tEnd - now(); else S.tEnd = now() + S.pausedLeft;
    updateClock(S.pausedLeft);
  }
  if (k === 'b') { S.blitzQueued = CFG.blitzLength; addAlert('<b>BLITZ ROUND</b> coming up'); }
  if (k === 'm') muted = !muted;
  if (k === 'r') { S.streamScores = new Map(); renderBoards(); }
});

// ------------------------------------------------------------------ boot
async function boot() {
  fit(); window.addEventListener('resize', fit);
  try {
    const c = await fetch('config.json', { cache: 'no-store' });
    if (c.ok) { const user = await c.json(); CFG = Object.assign({}, DEFAULTS, user.quiz || {}); }
  } catch (e) {}
  S.likeGoal = CFG.likeGoal;
  // Prefer the copy the weekly GitHub job keeps fresh; fall back to the one in this folder
  for (const src of [CFG.questionsUrl, 'data/questions.json'].filter(Boolean)) {
    try { const r = await fetch(src, { cache: 'no-store' }); if (r.ok) { S.data = await r.json(); break; } } catch (e) {}
  }
  if (!S.data) { body().innerHTML = '<div class="big-center"><div class="title">No questions found</div></div>'; return; }
  S.themes = S.data.themes.slice();
  renderLikes(); renderBoards();
  setInterval(tick, 200);
  if (PRACTICE) startPractice(); else connectBridge();
  startGame(params.get('theme') || 'Mixed');
}
boot();
// Test hooks: play one specific question, or end the current one
window.HHQ = { onEvent, state: S, play(q) { S.queue = [q]; S.qi = 0; nextQuestion(); }, end() { S.tEnd = now(); } };
})();
