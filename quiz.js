/* HoopsHype NBA Quiz Live: game engine.
   Events (chat, gifts, likes, follows, shares) arrive from the local bridge (bridge/quiz-bridge.mjs)
   over /events, or from the built-in practice simulator when the page is opened with ?practice=1.

   Operator keys (click the quiz window first): N = skip question, P = pause/resume,
   B = start a blitz round, M = sound on/off, R = reset stream scores. */
(() => {
'use strict';

// ------------------------------------------------------------------ config
const DEFAULTS = {
  imgBase: 'https://jsierrahoopshype.github.io/nba-headshots/players/headshots/face-fill-320/',
  questionsPerGame: 8,
  battleSlot: 4,                       // a chat battle is dropped in as question #5 of every game
  times: { guess: 45, mc: 20, tf: 14, hl: 15, battle: 18, board: 75, closest: 25, reveal: 7, intro: 5, recap: 9, voteResult: 5 },
  blitzTimes: { guess: 25, mc: 10, tf: 8, hl: 8, battle: 10, board: 40, closest: 14 },
  points: { easy: 50, medium: 75, hard: 100, rank: [50, 30, 20], board: 40, battle: 20, follow: 25, share: 50, perCoin: 10, closest: [150, 100, 50], exact: 300 },
  afterFirstCorrect: 8,                // seconds left once somebody nails a letter-reveal question
  likeGoal: 1500, likeGoalGrowth: 1.4,
  // The 4 theme-vote tiles. Each tile is tied to one gift; every coin of that gift is one vote.
  // Names must match TikTok's gift names exactly. The bridge window prints every gift name it sees.
  themeGifts: ['Rose', 'Ice Cream Cone', 'GG', 'Finger Heart'],
  powerups: { hint: 30, double: 99, blitz: 199 },   // coin thresholds for any other gift
  blitzLength: 3,
  diffMix: { easy: 0.5, medium: 0.4, hard: 0.1 },
  questionsUrl: 'https://raw.githubusercontent.com/jsierrahoopshype/hoopshype-quiz-live/HEAD/data/questions.json',
};
let CFG = DEFAULTS;
const params = new URLSearchParams(location.search);
const PRACTICE = params.has('practice');

// ------------------------------------------------------------------ utils
const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
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
  let s = String(text).toLowerCase().replace(/\s/g, '');
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
const img = f => f ? `<img src="${CFG.imgBase}${encodeURIComponent(f)}" alt="" onerror="this.style.visibility='hidden'">` : '';
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
  tStart: 0, tEnd: 0, paused: false, pausedLeft: 0,
  answered: new Map(), correct: [], firstCorrectAt: 0, closest: new Map(), filled: [],
  gameScores: new Map(), streamScores: new Map(), gifters: new Map(store('hhq_gifters') || []),
  names: new Map(), streaks: new Map(),
  voteThemes: [], votes: [0, 0, 0, 0],
  mult: 1, multBy: null, blitzLeft: 0, blitzQueued: 0,
  likes: 0, likeGoal: DEFAULTS.likeGoal, likeBase: 0,
  revealPlan: null, struck: new Set(), stats: null, connected: false,
};

function displayName(u) { return S.names.get(u) || u; }
function addPoints(u, pts) {
  if (!pts) return;
  S.gameScores.set(u, (S.gameScores.get(u) || 0) + pts);
  S.streamScores.set(u, (S.streamScores.get(u) || 0) + pts);
}

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
function markUsed(q) {
  S.used.add(q.id);
  const arr = [...S.used]; store('hhq_used', arr.slice(-4000));
}
function rollVoteThemes() {
  const options = S.themes.filter(t => t !== S.theme);
  S.voteThemes = shuffle(options).slice(0, 3).concat(Math.random() < 0.5 ? ['Mixed'] : [shuffle(options)[3] || 'Mixed']);
  S.votes = [0, 0, 0, 0];
  renderVote();
}

// ------------------------------------------------------------------ game flow
function startGame(theme) {
  S.game += 1;
  S.theme = theme;
  S.queue = pickQueue(theme);
  S.qi = 0;
  S.gameScores = new Map();
  S.stats = { answers: 0, players: new Set(), fastest: null, hardest: null, easiest: null, coins: 0 };
  rollVoteThemes();
  setPhase('intro', CFG.times.intro);
  renderIntro();
}
function nextQuestion() {
  if (S.qi >= S.queue.length) return endGame();
  const q = S.queue[S.qi];
  S.q = q; S.answered = new Map(); S.correct = []; S.firstCorrectAt = 0; S.closest = new Map(); S.struck = new Set();
  S.filled = q.slots ? q.slots.map(() => null) : [];
  S.battleVotes = [0, 0];
  if (S.blitzQueued && !S.blitzLeft) { S.blitzLeft = S.blitzQueued; S.blitzQueued = 0; addAlert('BLITZ ROUND: double points, half the time'); }
  const isBlitz = S.blitzLeft > 0;
  const tType = q.type === 'mc' && q.options.length === 2 ? 'tf' : q.type;
  const secs = (isBlitz ? CFG.blitzTimes[tType] : null) || CFG.times[tType] || 20;
  S.qMult = (isBlitz ? 2 : 1) * S.mult;
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
  // recap stats
  const n = q.type === 'board' ? S.filled.filter(Boolean).length : S.correct.length;
  if (q.type !== 'battle' && q.type !== 'closest') {
    if (!S.stats.hardest || n < S.stats.hardest.n) S.stats.hardest = { n, a: shortAnswer(q) };
    if (!S.stats.easiest || n > S.stats.easiest.n) S.stats.easiest = { n, a: shortAnswer(q) };
  }
  if (S.blitzLeft > 0) S.blitzLeft -= 1;
  if (S.mult > 1) { S.mult = 1; S.multBy = null; }
  setPhase('reveal', CFG.times.reveal);
  sfx.reveal();
  renderReveal();
  S.qi += 1;
}
function endGame() {
  setPhase('recap', CFG.times.recap);
  renderRecap();
}
function afterRecap() {
  // theme vote result
  let best = -1, idx = 0;
  S.votes.forEach((v, i) => { if (v > best) { best = v; idx = i; } });
  const winner = best > 0 ? S.voteThemes[idx] : rnd(S.voteThemes);
  S.nextTheme = winner;
  setPhase('voteResult', CFG.times.voteResult);
  renderVoteResult(winner, best);
}
function setPhase(p, secs) {
  S.phase = p; S.tStart = now(); S.tEnd = now() + secs * 1000; S.dur = secs * 1000;
}
function tick() {
  if (S.paused || !S.data) return;
  const left = S.tEnd - now();
  updateTimer(left);
  if (S.phase === 'question') {
    progressiveReveal();
    if (left <= 5000 && left > 0 && Math.ceil(left / 1000) !== S._lastTick) { S._lastTick = Math.ceil(left / 1000); sfx.tick(); }
  }
  if (left > 0) return;
  if (S.phase === 'intro') nextQuestion();
  else if (S.phase === 'question') endQuestion();
  else if (S.phase === 'reveal') nextQuestion();
  else if (S.phase === 'recap') afterRecap();
  else if (S.phase === 'voteResult') startGame(S.nextTheme);
}

// ------------------------------------------------------------------ letter reveal plan
function planReveals(q, secs) {
  S.revealPlan = null;
  if (q.type !== 'guess') return;
  const letters = [];
  [...q.answer].forEach((c, i) => { if (/[a-z0-9]/i.test(c)) letters.push(i); });
  const maxLetters = Math.floor(letters.length * 0.45);
  const order = shuffle(letters.slice()).slice(0, maxLetters);
  const startClues = q.clues.length >= 4 ? 2 : 1;
  const extraClues = q.clues.length - startClues;
  const T = secs * 1000;
  S.revealPlan = {
    shownLetters: new Set(),
    letterTimes: order.map((idx, i) => ({ idx, at: T * (0.2 + 0.75 * (i + 1) / (order.length + 1)) })),
    clueTimes: Array.from({ length: extraClues }, (_, i) => T * (0.08 + 0.6 * (i + 1) / (extraClues + 1))),
    shownClues: startClues, total: letters.length,
    zoom: q.imageMode === 'zoom',
  };
}
function progressiveReveal() {
  const P = S.revealPlan;
  if (!P) return;
  const t = now() - S.tStart;
  let changed = false;
  while (P.clueTimes.length && t >= P.clueTimes[0]) { P.clueTimes.shift(); P.shownClues++; changed = true; }
  while (P.letterTimes.length && t >= P.letterTimes[0].at) { P.shownLetters.add(P.letterTimes.shift().idx); changed = true; }
  if (changed) renderGuessBody();
  if (P.zoom) {
    const i = $('.face-wrap img');
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
    renderGuessBody();
  } else if (q.type === 'mc' && q.options.length > 2) {
    const wrong = q.options.map((_, i) => i).filter(i => i !== q.correct && !S.struck.has(i));
    if (wrong.length > 1) { S.struck.add(rnd(wrong)); renderQuestion(); }
  } else if (q.type === 'board') {
    const open = S.filled.map((f, i) => f ? null : i).filter(i => i != null);
    if (open.length) { const i = rnd(open); S.filled[i] = { u: null, hint: true }; renderQuestion(); }
  } else {
    S.tEnd += 8000; S.dur += 8000;
  }
  addAlert(`HINT DROP from ${esc(by)}`);
}

// ------------------------------------------------------------------ answers
function onChat(u, text) {
  S.stats && S.stats.players.add(u);
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
  if (q.options.length === 2 && q.options[0] === 'True') {
    if (['true', 't', 'yes', 'si', 'v', 'verdadero', 'a', '1'].includes(t)) return 0;
    if (['false', 'f', 'no', 'falso', 'b', '2'].includes(t)) return 1;
    return null;
  }
  const letters = { a: 0, b: 1, c: 2, d: 3, '1': 0, '2': 1, '3': 2, '4': 3 };
  const m = t.match(/^(?:option )?([abcd1-4])$/);
  if (m) return letters[m[1]];
  for (let i = 0; i < q.options.length; i++) {
    const o = norm(q.options[i]);
    if (t === o || (/[a-z]/.test(o) && nameMatch(text, acceptFor(q.options[i])))) return i;
  }
  return null;
}
function sideIndex(q, text) {
  const t = norm(text);
  if (['a', '1', 'left'].includes(t)) return 0;
  if (['b', '2', 'right'].includes(t)) return 1;
  for (let i = 0; i < 2; i++) if (nameMatch(text, acceptFor(q.sides[i].name))) return i;
  return null;
}
function basePoints(q) { return (CFG.points[q.difficulty] || 60) * (S.qMult || 1); }
function answerGuess(q, u, text) {
  if (S.correct.some(c => c.u === u)) return;
  if (!nameMatch(text, q.accept)) return;
  const P = S.revealPlan;
  const frac = P && P.total ? P.shownLetters.size / P.total : 0;
  const rank = S.correct.length;
  const pts = Math.round(basePoints(q) * (1 - 0.5 * frac)) + (CFG.points.rank[rank] || 0) * (S.qMult || 1);
  registerCorrect(u, pts);
  if (rank === 0) {
    S.firstCorrectAt = now();
    const cap = now() + CFG.afterFirstCorrect * 1000;
    if (S.tEnd > cap) { S.tEnd = cap; }
  }
}
function answerChoice(q, u, idx) {
  if (idx == null || S.answered.has(u)) return;      // first answer counts: no spamming every option
  if (q.type === 'mc' && S.struck.has(idx)) return;
  S.answered.set(u, { idx, at: now() });
  S.stats.answers++;
  if (q.type === 'battle') S.battleVotes[idx]++;
  renderLiveCounts();
}
function scoreChoice(q) {
  const right = [...S.answered.entries()].filter(([, a]) => a.idx === q.correct).sort((a, b) => a[1].at - b[1].at);
  right.forEach(([u], rank) => registerCorrect(u, basePoints(q) + (CFG.points.rank[rank] || 0) * (S.qMult || 1), true));
  // wrong answers break streaks
  [...S.answered.entries()].filter(([, a]) => a.idx !== q.correct).forEach(([u]) => S.streaks.set(u, 0));
}
function scoreBattle(q) {
  const win = S.battleVotes[0] === S.battleVotes[1] ? -1 : (S.battleVotes[0] > S.battleVotes[1] ? 0 : 1);
  S.battleWin = win;
  if (win < 0) return;
  [...S.answered.entries()].filter(([, a]) => a.idx === win).forEach(([u]) => { addPoints(u, CFG.points.battle * (S.qMult || 1)); S.correct.push({ u, pts: CFG.points.battle }); });
}
function answerBoard(q, u, text) {
  let hit = false;
  q.slots.forEach((s, i) => {
    if (S.filled[i] && S.filled[i].u !== null) return;
    if (S.filled[i] && S.filled[i].hint) return;
    if (nameMatch(text, s.accept)) { S.filled[i] = { u }; hit = true; }
  });
  if (!hit) return;
  const pts = CFG.points.board * (S.qMult || 1);
  addPoints(u, pts);
  const prev = S.correct.find(c => c.u === u);
  if (prev) prev.pts += pts; else S.correct.push({ u, pts });
  S.stats.answers++;
  sfx.correct();
  pushTicker(u, pts, S.correct.length === 1);
  renderQuestion();
  if (S.filled.every(Boolean)) S.tEnd = Math.min(S.tEnd, now() + 2500);
}
function answerClosest(q, u, text) {
  const v = parseNumber(text, q);
  if (v == null) return;
  if (!S.closest.has(u)) S.stats.answers++;
  S.closest.set(u, { v, at: now() });
  renderLiveCounts();
}
function scoreClosest(q) {
  const rows = [...S.closest.entries()].map(([u, a]) => ({ u, v: a.v, d: Math.abs(a.v - q.value), at: a.at }))
    .sort((a, b) => a.d - b.d || a.at - b.at);
  S.closestRows = rows.slice(0, 3);
  rows.slice(0, 3).forEach((r, i) => {
    const pts = (r.d === 0 ? CFG.points.exact : CFG.points.closest[i]) * (S.qMult || 1);
    addPoints(r.u, pts); r.pts = pts; S.correct.push({ u: r.u, pts });
  });
}
function registerCorrect(u, pts, quiet) {
  addPoints(u, pts);
  S.streaks.set(u, (S.streaks.get(u) || 0) + 1);
  S.correct.push({ u, pts, at: now() });
  if (!quiet) S.stats.answers++;
  if (S.correct.length === 1) {
    const secs = ((now() - S.tStart) / 1000);
    if (!S.stats.fastest || secs < S.stats.fastest.s) S.stats.fastest = { u, s: secs };
    if (!quiet) sfx.correct();
  }
  if (!quiet) pushTicker(u, pts, S.correct.length === 1);
  renderBoards();
}
function shortAnswer(q) { return q.type === 'board' ? q.prompt : q.answer; }

// ------------------------------------------------------------------ gifts, likes, social
function onGift(ev) {
  const u = ev.user, total = (ev.coins || 1) * (ev.count || 1);
  S.names.set(u, ev.nick || u);
  S.gifters.set(u, (S.gifters.get(u) || 0) + total);
  store('hhq_gifters', [...S.gifters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200));
  if (S.stats) S.stats.coins += total;
  addPoints(u, total * CFG.points.perCoin);
  sfx.gift();
  const tile = CFG.themeGifts.findIndex(g => norm(g) === norm(ev.gift));
  if (tile >= 0 && S.voteThemes[tile]) {
    S.votes[tile] += total;
    renderVote();
    addAlert(`${esc(displayName(u))} votes ${esc(S.voteThemes[tile])} +${total}`);
  } else if (total >= CFG.powerups.blitz) {
    S.blitzQueued = CFG.blitzLength;
    addAlert(`${esc(displayName(u))} called a BLITZ ROUND`);
  } else if (total >= CFG.powerups.double) {
    S.mult = 2; S.multBy = displayName(u);
    addAlert(`DOUBLE POINTS next question, thanks ${esc(displayName(u))}`);
  } else if (total >= CFG.powerups.hint) {
    hintNow(displayName(u));
  } else {
    addAlert(`${esc(displayName(u))} sent ${esc(ev.gift)}${ev.count > 1 ? ' x' + ev.count : ''}`);
  }
  renderBoards(); renderHeader();
}
function onLikes(n, total) {
  S.likes = total != null ? Math.max(S.likes, total) : S.likes + n;
  if (S.likes - S.likeBase >= S.likeGoal) {
    S.likeBase = S.likes;
    S.likeGoal = Math.round(S.likeGoal * CFG.likeGoalGrowth / 100) * 100;
    S.blitzQueued = CFG.blitzLength;
    addAlert('LIKE GOAL HIT: BLITZ ROUND next, double points');
  }
  renderLikes();
}
function onSocial(kind, u) {
  const pts = kind === 'share' ? CFG.points.share : CFG.points.follow;
  addPoints(u, pts);
  addAlert(`${esc(displayName(u))} ${kind === 'share' ? 'shared the LIVE' : 'followed'} +${pts}`);
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

// ------------------------------------------------------------------ rendering
const inner = () => $('#card-inner');
function renderHeader() {
  const q = S.q;
  const inQ = S.phase === 'question' && q;
  $('#pts').textContent = inQ && q.type !== 'battle' ? `+${basePoints(q)} POINTS` : 'NBA TRIVIA';
  const m = $('#mult');
  if (inQ && S.qMult > 1) { m.textContent = `x${S.qMult}`; m.classList.remove('hidden'); } else m.classList.add('hidden');
  const meta = $('#meta');
  if (S.phase === 'question' || S.phase === 'reveal') {
    const qn = Math.min(S.qi + 1, S.queue.length);
    meta.innerHTML = `<span>Game ${S.game}</span>·<span class="theme">${esc(S.theme)}</span>·<span>Question ${qn}/${S.queue.length}</span>` +
      (q && q.type !== 'battle' ? `<span class="diff ${q.difficulty}">${q.difficulty.toUpperCase()}</span>` : '') +
      (S.blitzLeft > 0 ? '<span class="blitz">BLITZ</span>' : '');
  } else meta.innerHTML = `<span>Game ${S.game}</span>·<span class="theme">${esc(S.theme || '')}</span>`;
}
function updateTimer(left) {
  const secs = Math.max(0, Math.ceil(left / 1000));
  $('#timer-num').textContent = S.paused ? 'II' : secs;
  const frac = S.dur ? Math.max(0, left / S.dur) : 0;
  $('#timer-arc').style.strokeDashoffset = String(276.5 * (1 - frac));
  $('#timer').classList.toggle('low', S.phase === 'question' && secs <= 5);
}
function setCta(t) { $('#cta').textContent = t; }

function renderIntro() {
  renderHeader();
  const how = {
    'Career Paths': 'We show the teams. You name the player.',
    'Stat Lines': 'A real season stat line. Whose was it?',
    'Draft & Bio': 'Draft nights, colleges, hometowns.',
    'Awards & Rings': 'MVPs, Finals MVPs, rings and All-Star nods.',
    'Record Book': 'All-time leaders and career records.',
    'Money Talks': 'Salaries and career earnings.',
    'Jersey Kings': 'The NBA\'s best-selling jerseys.',
    'Around the World': 'The league\'s international stars.',
    'Name the Face': 'The photo zooms out. Be first to name him.',
    'Franchise Legends': 'Every franchise\'s all-time greats.',
    'Mixed': 'A bit of everything.',
  }[S.theme] || '';
  inner().innerHTML = `<div class="intro"><div class="gno">Game ${S.game}</div><div class="th">${esc(S.theme)}</div>
    <div class="how">${esc(how)}</div><div class="by">Type your answers in chat. Fastest correct answer scores the most.</div></div>`;
  setCta('NEW GAME STARTING');
  $('#ticker-correct').innerHTML = '';
  renderBoards();
}
function promptHtml(q) {
  const long = q.prompt.length > 48 ? ' long' : '';
  return `<div class="prompt${long}">${esc(q.prompt)}</div>` + (q.sub ? `<div class="sub">${esc(q.sub)}</div>` : '');
}
function renderQuestion() {
  renderHeader();
  const q = S.q, c = inner();
  if (q.type === 'guess') { renderGuessBody(true); setCta('TYPE THE PLAYER\'S NAME IN CHAT'); return; }
  let h = promptHtml(q);
  if (q.type === 'mc') {
    const tf = q.options.length === 2 && q.options[0] === 'True';
    if (q.image) h += `<div class="opt-face">${img(q.image)}</div>`;
    h += '<div class="opts">' + q.options.map((o, i) => `<div class="opt${S.struck.has(i) ? ' struck' : ''}" data-i="${i}"><div class="bar"></div><span class="k">${tf ? (i ? 'F' : 'T') : 'ABCD'[i]}</span><span class="t">${esc(o)}</span><span class="n"></span></div>`).join('') + '</div>';
    setCta(tf ? 'TYPE TRUE OR FALSE IN CHAT' : 'TYPE A, B, C OR D IN CHAT');
  } else if (q.type === 'hl' || q.type === 'battle') {
    h += '<div class="vs">' + q.sides.map((s, i) => `<div class="side" data-i="${i}"><div class="key">${'AB'[i]}</div><div class="ph">${img(s.img)}</div><div class="nm">${esc(s.name)}</div>` +
      (q.type === 'hl' ? `<div class="val hide">???</div>` : `<div class="val" style="font-size:34px">${esc(s.value || '')}</div><div class="votes"></div>`) + '</div>').join('') + '<div class="mid">VS</div></div>';
    if (q.type === 'battle') h += '<div class="splitbar"><div class="l" style="width:50%"></div><div class="r"></div></div>';
    setCta(q.type === 'battle' ? 'VOTE: TYPE A OR B IN CHAT' : 'TYPE A OR B IN CHAT');
  } else if (q.type === 'board') {
    const one = q.slots.length <= 5 ? ' one' : '';
    h += `<div class="slots${one}">` + q.slots.map((s, i) => {
      const f = S.filled[i];
      if (f) return `<div class="slot filled"><span class="lab">${esc(s.label)}</span><span class="mini">${img(s.img)}</span><span><div class="who">${esc(s.name)}</div><div class="by">${f.hint ? 'hint' : esc(displayName(f.u))}</div></span></div>`;
      return `<div class="slot"><span class="lab">${esc(s.label)}</span><span class="who">${'?'.repeat(3)}</span></div>`;
    }).join('') + '</div>';
    h += `<div class="boardcount">${S.filled.filter(Boolean).length} / ${q.slots.length} found</div>`;
    setCta('NAME AS MANY AS YOU CAN IN CHAT');
  } else if (q.type === 'closest') {
    if (q.image) h += `<div class="opt-face" style="width:220px;height:220px">${img(q.image)}</div>`;
    h += `<div class="bignum">?</div><div class="guesses" id="guesses">0 guesses so far</div>`;
    setCta('TYPE A NUMBER. CLOSEST WINS');
  }
  c.innerHTML = h;
  renderLiveCounts();
}
function renderGuessBody(full) {
  const q = S.q, P = S.revealPlan;
  if (!q || q.type !== 'guess' || S.phase !== 'question') return;
  const c = inner();
  const shownClues = P ? P.shownClues : q.clues.length;
  let h = promptHtml(q);
  if (q.image && q.imageMode === 'zoom') h += `<div class="face-wrap">${img(q.image)}</div>`;
  h += '<div class="clues">' + q.clues.map((cl, i) => i < shownClues
    ? `<div class="clue">${esc(cl)}</div>` : (q.image ? '' : `<div class="clue next">.</div>`)).join('') + '</div>';
  const words = q.answer.split(' ');
  const totalChars = q.answer.replace(/ /g, '').length;
  const small = totalChars > 15 ? ' small' : '';
  let pos = 0;
  h += '<div class="letters">' + words.map(w => {
    const tiles = [...w].map(ch => {
      const i = pos++;
      if (!/[a-z0-9]/i.test(ch)) return `<span class="tile punct${small}">${esc(ch)}</span>`;
      const show = P && P.shownLetters.has(i);
      return `<span class="tile${small}${show ? ' shown' : ''}">${show ? esc(ch.toUpperCase()) : ''}</span>`;
    }).join('');
    pos++;
    return `<span class="word">${tiles}</span>`;
  }).join('') + '</div>';
  const keepZoom = c.querySelector('.face-wrap img');
  c.innerHTML = h;
  if (keepZoom) { const i = c.querySelector('.face-wrap img'); if (i) i.style.transform = keepZoom.style.transform; }
}
function renderLiveCounts() {
  const q = S.q;
  if (!q || S.phase !== 'question') return;
  if (q.type === 'mc' || q.type === 'hl') {
    $('#cta').textContent = (q.type === 'hl' ? 'TYPE A OR B IN CHAT' : (q.options.length === 2 ? 'TYPE TRUE OR FALSE IN CHAT' : 'TYPE A, B, C OR D IN CHAT')) + (S.answered.size ? ` · ${S.answered.size} ANSWERED` : '');
  } else if (q.type === 'battle') {
    const [a, b] = S.battleVotes, t = a + b;
    const l = $('.splitbar .l'); if (l) l.style.width = (t ? (100 * a / t) : 50) + '%';
    document.querySelectorAll('.side').forEach((s, i) => {
      s.querySelector('.votes').textContent = t ? `${Math.round(100 * S.battleVotes[i] / t)}% · ${S.battleVotes[i]} votes` : '';
      s.classList.toggle('lead', t > 0 && S.battleVotes[i] > S.battleVotes[1 - i]);
    });
  } else if (q.type === 'closest') {
    const g = $('#guesses'); if (g) g.textContent = `${S.closest.size} guess${S.closest.size === 1 ? '' : 'es'} so far`;
  }
}
function renderReveal() {
  renderHeader();
  const q = S.q;
  let h = '<div class="reveal">';
  if (q.type === 'battle') {
    const t = S.battleVotes[0] + S.battleVotes[1];
    h += `<div class="label">CHAT HAS SPOKEN</div>`;
    if (S.battleWin >= 0) {
      const s = q.sides[S.battleWin];
      h += `<div class="ans">${esc(s.name)}</div><div class="face">${img(s.img)}</div>
        <div class="fact">${Math.round(100 * S.battleVotes[S.battleWin] / t)}% of ${t} votes. Everyone on the winning side gets +${CFG.points.battle * (S.qMult || 1)}</div>`;
    } else h += `<div class="ans mid">It's a tie</div><div class="fact">${t} votes, split right down the middle</div>`;
  } else if (q.type === 'board') {
    const n = S.filled.filter(f => f && !f.hint).length;
    h += `<div class="label">BOARD COMPLETE</div><div class="ans mid">${n} of ${q.slots.length} found</div>`;
    h += '<div class="slots' + (q.slots.length <= 5 ? ' one' : '') + '" style="width:100%">' + q.slots.map((s, i) => {
      const f = S.filled[i];
      return `<div class="slot ${f ? 'filled' : 'missed'}"><span class="lab">${esc(s.label)}</span><span class="mini">${img(s.img)}</span><span><div class="who">${esc(s.name)}</div><div class="by">${f ? (f.hint ? 'hint' : esc(displayName(f.u))) : 'nobody got it'}</div></span></div>`;
    }).join('') + '</div>';
  } else if (q.type === 'closest') {
    h += `<div class="label">THE ANSWER</div><div class="ans">${esc(q.answer)}</div>`;
    if (q.fact) h += `<div class="fact">${esc(q.fact)}</div>`;
    h += '<div class="closest-list" style="width:100%">' + (S.closestRows || []).map((r, i) =>
      `<div class="closest-row${i === 0 ? ' win' : ''}"><span>${i + 1}. ${esc(displayName(r.u))} said ${fmt(r.v)}</span><span style="color:var(--gold)">+${r.pts}</span></div>`).join('') +
      (S.closestRows && S.closestRows.length ? '' : '<div class="closest-row">No guesses this time</div>') + '</div>';
  } else {
    const face = q.revealImage || (q.type === 'guess' ? q.image : null) || (q.type === 'hl' ? q.sides[q.correct].img : null);
    h += `<div class="label">CORRECT ANSWER</div><div class="ans${q.answer.length > 18 ? ' mid' : ''}">${esc(q.answer)}</div>`;
    if (face) h += `<div class="face">${img(face)}</div>`;
    if (q.type === 'hl') h += `<div class="fact">${esc(q.sides[0].name)}: ${esc(q.sides[0].value)} · ${esc(q.sides[1].name)}: ${esc(q.sides[1].value)}</div>`;
    if (q.fact) h += `<div class="fact">${esc(q.fact)}</div>`;
    if (q.type === 'mc') {
      const counts = q.options.map((_, i) => [...S.answered.values()].filter(a => a.idx === i).length);
      const tot = counts.reduce((a, b) => a + b, 0);
      if (tot) h += `<div class="count">${counts[q.correct]} of ${tot} got it right</div>`;
    } else h += `<div class="count">${S.correct.length ? S.correct.length + ' correct' : 'Nobody got it'}</div>`;
    h += '<div class="winners">' + S.correct.slice(0, 4).map((c, i) =>
      `<div class="winner" style="animation-delay:${i * 80}ms"><span>${i === 0 ? 'Fastest: ' : ''}${esc(displayName(c.u))}${(S.streaks.get(c.u) || 0) >= 3 ? ' · ' + S.streaks.get(c.u) + ' in a row' : ''}</span><span class="p">+${c.pts}</span></div>`).join('') + '</div>';
  }
  h += '</div>';
  inner().innerHTML = h;
  setCta(S.qi + 1 >= S.queue.length ? 'GAME RECAP NEXT' : 'NEXT QUESTION COMING UP');
  renderBoards();
}
function renderRecap() {
  renderHeader();
  const st = S.stats, top = [...S.gameScores.entries()].sort((a, b) => b[1] - a[1]);
  const li = [];
  if (top.length) li.push(`Game winner: <b>${esc(displayName(top[0][0]))}</b> with ${fmt(top[0][1])} points`);
  li.push(`<b>${fmt(st.answers)}</b> answers from <b>${st.players.size}</b> players`);
  if (st.fastest) li.push(`Fastest: <b>${esc(displayName(st.fastest.u))}</b> in ${st.fastest.s.toFixed(1)}s`);
  if (st.hardest) li.push(`Hardest: <b>${esc(st.hardest.a.length > 40 ? st.hardest.a.slice(0, 40) + '...' : st.hardest.a)}</b>, ${st.hardest.n} got it`);
  const streak = [...S.streaks.entries()].sort((a, b) => b[1] - a[1])[0];
  if (streak && streak[1] >= 3) li.push(`Hot streak: <b>${esc(displayName(streak[0]))}</b>, ${streak[1]} in a row`);
  inner().innerHTML = `<div class="recap"><h2>Game ${S.game} recap</h2><ul>${li.map(x => `<li>${x}</li>`).join('')}</ul></div>`;
  setCta('SEND A GIFT TO PICK THE NEXT THEME');
}
function renderVoteResult(theme, votes) {
  inner().innerHTML = `<div class="intro"><div class="gno">Next up</div><div class="th">${esc(theme)}</div>
    <div class="how">${votes > 0 ? `Picked by your gifts: ${fmt(votes)} votes` : 'Picked at random. Send a gift to choose the next one'}</div></div>`;
  setCta('GET READY');
}
function renderVote() {
  const tot = S.votes.reduce((a, b) => a + b, 0), max = Math.max(...S.votes);
  $('#vote-tiles').innerHTML = S.voteThemes.map((t, i) => `<div class="vt${max > 0 && S.votes[i] === max ? ' lead' : ''}">
    <div class="g">${esc(CFG.themeGifts[i] || '')}</div><div class="nm">${esc(t)}</div><div class="c">${S.votes[i] || ''}</div>
    <div class="fill" style="width:${tot ? 100 * S.votes[i] / tot : 0}%"></div></div>`).join('');
}
function renderBoards() {
  const fill = (sel, entries, unit) => {
    const rows = entries.slice(0, 4);
    $(sel).innerHTML = rows.length ? rows.map(([u, v], i) => `<li><span class="u">${i + 1}. ${esc(displayName(u))}</span><span class="s">${fmt(v)}${unit}</span></li>`).join('')
      : '<li class="empty">Be the first</li>';
  };
  fill('#lb-game', [...S.gameScores.entries()].sort((a, b) => b[1] - a[1]), '');
  fill('#lb-stream', [...S.streamScores.entries()].sort((a, b) => b[1] - a[1]), '');
  fill('#lb-gift', [...S.gifters.entries()].sort((a, b) => b[1] - a[1]), '');
}
function renderLikes() {
  const got = S.likes - S.likeBase;
  $('#likefill').style.width = Math.min(100, 100 * got / S.likeGoal) + '%';
  $('#liketext').textContent = `Likes ${fmt(got)} / ${fmt(S.likeGoal)}: hit the goal for a BLITZ ROUND, double points`;
}
function pushTicker(u, pts, first) {
  const t = $('#ticker-correct');
  const chip = el('div', 'tc' + (first ? ' first' : ''), `${first ? 'FIRST ' : ''}${esc(displayName(u))} <b>+${pts}</b>`);
  t.prepend(chip);
  while (t.children.length > 6) t.lastChild.remove();
}
// Alerts replace the bottom strip for a few seconds (in-page, never a pop-up over the quiz)
const alertQ = [];
let alertBusy = false;
function addAlert(html) {
  alertQ.push(html);
  if (alertQ.length > 6) alertQ.shift();
  if (!alertBusy) nextAlert();
}
function nextAlert() {
  const a = $('#alert-strip');
  if (!alertQ.length) { alertBusy = false; a.classList.remove('show'); return; }
  alertBusy = true;
  a.innerHTML = alertQ.shift();
  a.classList.remove('show'); void a.offsetWidth; a.classList.add('show');
  setTimeout(nextAlert, 3200);
}
const HINTS = () => [
  'Type your answer in chat. <b>Fastest correct answer</b> scores the most',
  `<b>${CFG.themeGifts.join(', ')}</b> pick the next theme. 1 coin = 1 vote`,
  `Gifts of <b>${CFG.powerups.hint}+ coins</b> drop a hint for everyone`,
  `<b>${CFG.powerups.double}+ coins</b>: double points on the next question`,
  `<b>${CFG.powerups.blitz}+ coins</b> or the like goal: <b>BLITZ ROUND</b>`,
  `Follow <b>+${CFG.points.follow}</b> · Share the LIVE <b>+${CFG.points.share}</b> points`,
  'New here? Just type your answer. <b>No sign-up</b>',
];
let hintIdx = 0;
function rotateHint() {
  if (!S.connected && !PRACTICE) { $('#hint-line').innerHTML = esc(S.statusText || 'Connecting to chat...'); return; }
  const h = HINTS();
  $('#hint-line').innerHTML = h[hintIdx++ % h.length];
}
function preload(q) {
  if (!q) return;
  [q.image, q.revealImage, ...(q.sides || []).map(s => s.img), ...(q.slots || []).map(s => s.img)]
    .filter(Boolean).forEach(f => { const i = new Image(); i.src = CFG.imgBase + encodeURIComponent(f); });
}

// ------------------------------------------------------------------ layout: scale the 1080x1920 stage to the window
function fit() {
  const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  const st = $('#stage');
  st.style.transform = `scale(${s})`;
  st.style.left = ((window.innerWidth - 1080 * s) / 2) + 'px';
  st.style.top = ((window.innerHeight - 1920 * s) / 2) + 'px';
}

// ------------------------------------------------------------------ live events from the bridge
function connectBridge() {
  let es;
  const open = () => {
    try { es = new EventSource('/events'); } catch (e) { return setTimeout(open, 3000); }
    es.onmessage = m => { try { onEvent(JSON.parse(m.data)); } catch (e) {} };
    es.onerror = () => { S.connected = false; S.statusText = 'Quiz bridge not running. Start it with START-HOOPSHYPE-QUIZ.bat'; es.close(); setTimeout(open, 3000); };
  };
  open();
}

// ------------------------------------------------------------------ practice simulator (fake chat, gifts, likes)
function startPractice() {
  S.connected = true;
  const bots = ['hoopsfan23', 'Lakeshow4L', 'bucketsgetter', 'mamba_mentality', 'jokicmagic', 'Celtics_17', 'curryrange30',
    'dunkcity', 'goatdebate', 'NBAnerd', 'courtvision', 'ballislife', 'triple_double', 'splash_bro', 'thunderup', 'mavsfan41',
    'heatculture', 'knicksknation', 'okc_boomer', 'spursway21', 'rim_protector', 'stepbackthree', 'fastbreak', 'hoopdreams'];
  const gifts = [['Rose', 1], ['Ice Cream Cone', 1], ['GG', 1], ['Finger Heart', 5], ['Doughnut', 30], ['Hand Hearts', 100], ['Confetti', 100], ['Hat and Mustache', 99], ['Corgi', 299]];
  const skill = { easy: 0.55, medium: 0.35, hard: 0.15 };
  const say = (u, text) => onEvent({ kind: 'chat', user: u, nick: u, text });
  setInterval(() => {
    const u = rnd(bots), q = S.q;
    if (S.phase !== 'question' || !q) { if (Math.random() < 0.3) say(u, rnd(['lets go', 'gg', 'this is fun', 'next one', 'hi from Madrid'])); return; }
    const elapsed = (now() - S.tStart) / S.dur;
    const p = (skill[q.difficulty] || 0.35) * (0.4 + elapsed);
    const right = Math.random() < p;
    if (q.type === 'guess') say(u, right ? q.answer : rnd(['LeBron', 'Kobe Bryant', 'Tim Duncan', 'Chris Paul', 'idk']));
    else if (q.type === 'mc') say(u, right ? 'ABCD'[q.correct] : rnd(['A', 'B', 'C', 'D'].slice(0, q.options.length)));
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
    if (S.paused) S.pausedLeft = S.tEnd - now(); else { S.tEnd = now() + S.pausedLeft; }
    updateTimer(S.pausedLeft);
  }
  if (k === 'b') { S.blitzQueued = CFG.blitzLength; addAlert('BLITZ ROUND coming up'); }
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
  if (params.get('blitz')) S.blitzQueued = CFG.blitzLength;
  S.likeGoal = CFG.likeGoal;
  // Prefer the copy the weekly GitHub job keeps fresh; fall back to the one in this folder
  for (const src of [CFG.questionsUrl, 'data/questions.json'].filter(Boolean)) {
    try { const r = await fetch(src, { cache: 'no-store' }); if (r.ok) { S.data = await r.json(); break; } } catch (e) {}
  }
  if (!S.data) { $('#card-inner').innerHTML = '<div class="intro"><div class="th">No questions found</div></div>'; return; }
  S.themes = S.data.themes.slice();
  renderLikes(); renderBoards(); rotateHint();
  setInterval(rotateHint, 6000);
  setInterval(tick, 200);
  if (PRACTICE) startPractice(); else connectBridge();
  const first = params.get('theme') || 'Mixed';
  startGame(first);
}
boot();
// Exposed for testing and for the bridge to forward events in-page if needed
window.HHQ = { onEvent, state: S, play(q) { S.queue = [q]; S.qi = 0; nextQuestion(); }, end() { S.tEnd = now(); } };
})();
