/* 幸とソロQ — データは localStorage（この端末）だけ。外には何も送らない */
'use strict';

// ===== 定数 =====
const KEY = 'soloq.v1';
const THEMES = ['プリエイム', 'クロスヘアの高さ', '撃ち合い後のリポジション', 'スキルを使ってから入る', '報告を短く',
  'エコラウンドの判断', '最初のデス後に味方を見る', 'ストッピングしてから撃つ', 'ミニマップを見る', '無理にピークしない'];
const AGENTS = ['アストラ', 'アイソ', 'ヴァイス', 'ヴァイパー', 'ヴィトー', 'ウェイレイ', 'オーメン', 'キルジョイ', 'クローヴ', 'ケイオー',
  'ゲッコー', 'サイファー', 'ジェット', 'スカイ', 'セージ', 'ソーヴァ', 'チェンバー', 'テホ', 'デッドロック', 'ネオン',
  'ハーバー', 'フェイド', 'フェニックス', 'ブリーチ', 'ブリムストーン', 'ヨル', 'レイズ', 'レイナ'];
const MAPS = ['アセント', 'アビス', 'アイスボックス', 'カロード', 'サンセット', 'スプリット', 'パール', 'バインド', 'フラクチャー',
  'ブリーズ', 'ヘイヴン', 'ロータス'];
const RES = { win: '勝ち', loss: '負け', draw: '引き分け' };
const RES1 = { win: '勝', loss: '負', draw: '分' };
const MARK = { o: '○', m: '△', x: '×' };
const MARKW = { o: 'できた', m: 'まあまあ', x: 'まだ' };
const QUICK = { win: [15, 18, 20, 22, 25], loss: [-10, -13, -15, -18, -20], draw: [-2, 0, 2] };

const DEF = () => ({
  v: 1, matches: [], sessions: [], customThemes: [], theme: null, activeSession: null, rot: {},
  lastRR: { win: 20, loss: -15, draw: 0 }, recentAgents: [], lastReact: null, lastReview: null,
  settings: { riotName: '', riotTag: '', voice: true, volume: 0.9, look: 'system', dayStart: 5, cap: 5, radioAuto: true },
});

// ===== 保存 =====
let S;
function load() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { raw = null; }
  const d = DEF();
  S = Object.assign(d, raw || {});
  S.settings = Object.assign(DEF().settings, (raw && raw.settings) || {});
  S.lastRR = Object.assign(DEF().lastRR, (raw && raw.lastRR) || {});
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('保存できませんでした（ブラウザの容量や設定を確認してね）'); } }

// ===== 小道具 =====
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n);
const cls = n => n > 0 ? 'plus' : n < 0 ? 'minus' : '';
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
function dayKey(ts) {
  const d = new Date(ts - S.settings.dayStart * 3600e3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const dayLabel = k => { const [, m, d] = k.split('-'); return `${+m}/${+d}`; };
const hm = ts => { const d = new Date(ts); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
function hash(s) { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
const pick = (arr, seed) => arr[hash(seed) % arr.length];
let toastT;
function toast(msg) {
  let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
}
const sum = (a, f) => a.reduce((s, x) => s + (f(x) || 0), 0);
const allThemes = () => THEMES.concat(S.customThemes.filter(t => !THEMES.includes(t)));
const byTs = (a, b) => a.ts - b.ts;
const sessMatches = id => S.matches.filter(m => m.session === id).sort(byTs);
const active = () => S.sessions.find(s => s.id === S.activeSession && !s.end) || null;
function streak(list) {
  let type = null, n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i].result;
    if (r === 'draw') break;
    if (type === null) type = r;
    if (r !== type) break;
    n++;
  }
  return { type, n };
}
function themeStat(name) {
  const ms = S.matches.filter(m => m.theme === name && m.mark);
  return { n: ms.length, o: ms.filter(m => m.mark === 'o').length, m: ms.filter(m => m.mark === 'm').length, x: ms.filter(m => m.mark === 'x').length };
}

// ===== 声とせりふ =====
let LINES = null;
let DUR = {};
const sfx = $('#sfx');
const radioEl = $('#radioAudio');
async function loadLines() {
  try {
    const [a, b] = await Promise.all([fetch('voice/lines.json').then(r => r.json()), fetch('audio/index.json').then(r => r.json()).catch(() => ({}))]);
    LINES = a; DUR = b;
  } catch (e) { LINES = { reactions: {}, radio: [], speakers: {} }; }
}
function clipFor(cat) {
  const list = (LINES && LINES.reactions[cat]) || [];
  if (!list.length) return null;
  const i = (S.rot[cat] || 0) % list.length;
  S.rot[cat] = i + 1;
  return list[i];
}
function react(cat, notes = []) {
  const clip = clipFor(cat);
  S.lastReact = { cat, clip: clip ? clip.id : null, notes, ts: Date.now() };
  save();
  playClip(clip);
  renderSachi();
}
function playClip(clip) {
  if (!clip || !S.settings.voice) return;
  if (!radioEl.paused) return; // ラジオ中は声を重ねない
  try {
    sfx.src = `audio/${clip.id}.mp3`; sfx.volume = S.settings.volume; sfx.currentTime = 0;
    const p = sfx.play(); if (p) p.catch(() => {});
  } catch (e) { }
}
function findClip(id) {
  if (!LINES || !id) return null;
  for (const cs of Object.values(LINES.reactions)) for (const c of cs) if (c.id === id) return c;
  return null;
}
function duoHTML(lines) {
  const sp = (LINES && LINES.speakers) || {};
  return `<div class="duo">${lines.map(l => `<div class="say"><span class="face ${l.s}" aria-hidden="true">${esc((sp[l.s] || {}).label ? sp[l.s].label[0] : '幸')}</span><div><div class="who">${esc((sp[l.s] || {}).label || '幸')}</div><div class="bubble">${esc(l.t)}</div></div></div>`).join('')}</div>`;
}

// ===== 試合の記録 =====
function addMatch(m, { quiet = false } = {}) {
  S.matches.push(m);
  if (m.agent) S.recentAgents = [m.agent].concat(S.recentAgents.filter(a => a !== m.agent)).slice(0, 6);
  if (m.result && typeof m.rr === 'number') S.lastRR[m.result] = m.rr;
  save();
  if (!quiet) afterMatch(m);
}
function afterMatch(m) {
  const s = m.session ? S.sessions.find(x => x.id === m.session) : null;
  const list = s ? sessMatches(s.id) : S.matches.filter(x => dayKey(x.ts) === dayKey(m.ts)).sort(byTs);
  const net = sum(list, x => x.rr);
  const prev = net - (m.rr || 0);
  const st = streak(list);
  const notes = [];
  notes.push(s ? `セッション ${list.length}/${s.cap}試合・${sgn(net)}RR` : `今日 ${list.length}試合・${sgn(net)}RR`);
  if (m.theme && m.mark) { const t = themeStat(m.theme); notes.push(`テーマ「${m.theme}」${MARK[m.mark]}（これまで ${t.o}/${t.n} で○）`); }
  let cat;
  if (s && s.goal && prev < s.goal && net >= s.goal) cat = 'rr_milestone';
  else if (!(s && s.goal) && net >= 50 && Math.floor(net / 50) > Math.floor(prev / 50)) cat = 'rr_milestone';
  else if (s && list.length === s.cap) cat = 'cap_reached';
  else if (m.result === 'win' && st.type === 'win' && st.n >= 3) cat = 'win_streak';
  else if (m.result === 'loss' && st.type === 'loss' && st.n >= 3) cat = 'loss_streak';
  else if (m.result !== 'win' && m.mark === 'o') cat = 'theme_ok';
  else if (m.result === 'loss' && (m.mark === 'm' || m.mark === 'x') && S.matches.length % 2 === 0) cat = 'theme_miss';
  else if (m.result === 'draw' && m.mark && m.mark !== 'o') cat = 'theme_miss';
  else cat = m.result;
  if (s && list.length >= s.cap && cat !== 'cap_reached') notes.push(`決めていた ${s.cap}試合に届いています。今日はここまでにしませんか？`);
  react(cat, notes);
}
// 自動取り込み（fetcher.js）から来た試合を入れる。extId で重複をはじく
function importMatches(list) {
  const have = new Set(S.matches.map(m => m.extId).filter(Boolean));
  let n = 0;
  for (const x of list || []) {
    if (!x || !x.extId || have.has(x.extId) || !RES[x.result] || !x.ts) continue;
    const sess = S.sessions.find(s => x.ts >= s.start && x.ts <= (s.end || Date.now()));
    S.matches.push({ id: uid(), ts: +x.ts, result: x.result, rr: typeof x.rr === 'number' ? x.rr : 0, agent: x.agent || '', map: x.map || '',
      k: x.k ?? null, d: x.d ?? null, a: x.a ?? null, theme: null, mark: null, session: sess ? sess.id : null, src: window.SoloQSource.id, extId: String(x.extId) });
    have.add(x.extId); n++;
  }
  save();
  return n;
}
async function syncFromSource() {
  const src = window.SoloQSource;
  if (!src || !src.enabled) return 0;
  const since = Math.max(0, ...S.matches.filter(m => m.extId).map(m => m.ts));
  const list = await src.fetchMatches({ name: S.settings.riotName, tag: S.settings.riotTag, since });
  const n = importMatches(list);
  renderAll();
  return n;
}

// ===== セッション =====
function startSession(cap, goal) {
  const s = { id: uid(), start: Date.now(), end: null, cap, goal: goal || null, review: null };
  S.sessions.push(s); S.activeSession = s.id; S.lastReview = null; S.settings.cap = cap;
  save();
  react('session_start', [`今日は ${cap}試合まで${goal ? `・目標 +${goal}RR` : ''}。ラウンド中は声を出しません。`]);
  renderAll();
}
function endSession() {
  const s = active(); if (!s) return;
  s.end = Date.now();
  const list = sessMatches(s.id);
  s.review = buildReview(s, list);
  S.activeSession = null; S.lastReview = s.id;
  save();
  const net = sum(list, m => m.rr);
  react(net > 0 ? 'session_end_good' : net < 0 ? 'session_end_bad' : 'session_end_even', []);
  renderAll();
}
function buildReview(s, list) {
  const seed = s.id;
  const n = list.length;
  if (!n) return ['今日は記録なしでおしまい。開いてくれただけでも、えらいです。またね。'];
  const w = list.filter(m => m.result === 'win').length, l = list.filter(m => m.result === 'loss').length, d = n - w - l;
  const net = sum(list, m => m.rr);
  const out = [];
  const head = `${n}試合で ${w}勝${l}敗${d ? d + '分' : ''}、${sgn(net)}RR。`;
  if (net >= 30) out.push(head + pick(['しっかりプラスで終われました。', '今日はいい日でしたね。', '積み上げた分、ちゃんと形になっています。'], seed));
  else if (net > 0) out.push(head + pick(['小さくても、プラスはプラスです。', 'ちょっとずつ前に進めました。'], seed));
  else if (net === 0) out.push(head + pick(['とんとんで、崩れずに終われたのは立派です。', 'プラマイゼロ。守りきりました。'], seed));
  else if (net > -30) out.push(head + pick(['少しマイナスですが、こういう日もあります。', '今日はちょっと向かい風でしたね。'], seed));
  else out.push(head + pick(['今日はきつかったですね。それでも最後まで記録したのはえらいです。', '数字はへこみましたが、ここで止められたのが大事です。'], seed));
  if (s.goal) out.push(net >= s.goal ? `目標の +${s.goal}RR も達成。おめでとうございます！` : `目標の +${s.goal}RR まではあと ${s.goal - net}RR。次のセッションの楽しみにとっておきましょう。`);
  const marked = list.filter(m => m.mark);
  if (marked.length) {
    const o = marked.filter(m => m.mark === 'o').length;
    const names = [...new Set(marked.map(m => m.theme))];
    const tn = names.length === 1 ? `「${names[0]}」` : '';
    if (o / marked.length >= 0.6) out.push(`テーマ${tn}は ${marked.length}回中 ${o}回が○。体が覚えはじめていますね。${pick(['そろそろ次のテーマに進んでもいいかも。', 'この調子でもう少し続けてみましょう。'], seed + 't')}`);
    else if (o > 0) out.push(`テーマ${tn}は ${marked.length}回中 ${o}回が○。できた回があるなら、もう半分来ています。`);
    else out.push(`テーマ${tn}は今日は○なし。むずかしいテーマほど伸びしろです。次も同じテーマでいきましょう。`);
  } else out.push('次は試合の前に、テーマをひとつだけ選んでみませんか。勝ち負けとは別の「できた」が増えます。');
  const byMap = {};
  for (const m of list) if (m.map) { byMap[m.map] = byMap[m.map] || { w: 0, n: 0 }; byMap[m.map].n++; if (m.result === 'win') byMap[m.map].w++; }
  const best = Object.entries(byMap).filter(([, v]) => v.w > 0).sort((a, b) => b[1].w - a[1].w || a[1].n - b[1].n)[0];
  if (best) out.push(`いちばん良かったのは ${best[0]}（${best[1].n}試合で${best[1].w}勝）。`);
  const kd = list.filter(m => m.k != null && m.d != null);
  if (kd.length >= 2) { const k = sum(kd, m => m.k), dd = sum(kd, m => m.d); out.push(`キル・デスは合わせて ${k}/${dd}（${dd ? (k / dd).toFixed(2) : k}）。`); }
  let maxL = 0, cur = 0; for (const m of list) { cur = m.result === 'loss' ? cur + 1 : 0; maxL = Math.max(maxL, cur); }
  if (n === s.cap) out.push(pick(['決めた試合数で止められたのも、地味にすごいことです。', '上限を守って終われました。これがいちばん効きます。'], seed + 'c'));
  else if (n < s.cap) out.push('上限より早めに切り上げたのも、いい判断です。');
  else out.push(`上限を ${n - s.cap}試合こえちゃいましたね。次は上限のところで一回休憩をはさみましょう。`);
  if (maxL >= 3) out.push('連敗のところで一息入れられると、もっと楽になりますよ。');
  out.push(pick(['おつかれさまでした。目と手首を休ませてね。', 'おつかれさまでした。お水を一杯どうぞ。', 'おつかれさまでした。また一緒にやりましょう。'], seed + 'e'));
  return out;
}

// ===== グラフ（線1本・ホバー/タップで値） =====
function drawLine(el, pts, { label = v => sgn(v) + 'RR', h = 150, empty = 'まだ記録がありません' } = {}) {
  if (!pts.length) { el.innerHTML = `<p class="muted small" style="margin:6px 0">${esc(empty)}</p>`; return; }
  const W = Math.max(260, el.clientWidth || 320), H = h, padL = 34, padR = 40, padT = 14, padB = 22;
  const ys = pts.map(p => p.y).concat(0);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 10) { hi += 5; lo -= 5; }
  const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
  const X = i => pts.length === 1 ? padL + (W - padL - padR) / 2 : padL + i * (W - padL - padR) / (pts.length - 1);
  const Y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="RRの推移。最後は ${esc(label(last.y))}">
    <line x1="${padL}" x2="${W - padR}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)" stroke-width="1.5" stroke-dasharray="4 4"/>
    <text x="${padL - 6}" y="${Y(0) + 4}" font-size="11" text-anchor="end" fill="var(--muted)">0</text>
    ${Y(0) - padT > 14 ? `<text x="${padL - 6}" y="${padT + 4}" font-size="11" text-anchor="end" fill="var(--muted)">${Math.round(hi)}</text>` : ''}
    ${H - padB - Y(0) > 14 ? `<text x="${padL - 6}" y="${H - padB + 2}" font-size="11" text-anchor="end" fill="var(--muted)">${Math.round(lo)}</text>` : ''}
    <text x="${X(0)}" y="${H - 4}" font-size="11" text-anchor="${pts.length === 1 ? 'middle' : 'start'}" fill="var(--muted)">${esc(pts[0].x)}</text>
    ${pts.length > 1 ? `<text x="${X(pts.length - 1)}" y="${H - 4}" font-size="11" text-anchor="end" fill="var(--muted)">${esc(last.x)}</text>` : ''}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `<circle cx="${X(i)}" cy="${Y(p.y)}" r="4" fill="${p.c || 'var(--accent)'}" stroke="var(--card)" stroke-width="2"/>`).join('')}
    <text x="${X(pts.length - 1) + 8}" y="${Y(last.y) + 4}" font-size="12" font-weight="800" fill="var(--ink)">${esc(label(last.y))}</text>
    <line class="cross" x1="0" x2="0" y1="${padT}" y2="${H - padB}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>
  </svg><div class="tip" hidden></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), cross = el.querySelector('.cross');
  const show = ev => {
    const r = svg.getBoundingClientRect(); const x = (ev.clientX - r.left) * W / r.width;
    let bi = 0, bd = 1e9; pts.forEach((p, i) => { const dd = Math.abs(X(i) - x); if (dd < bd) { bd = dd; bi = i; } });
    const p = pts[bi];
    cross.setAttribute('x1', X(bi)); cross.setAttribute('x2', X(bi)); cross.setAttribute('visibility', 'visible');
    tip.hidden = false; tip.textContent = p.tip || `${p.x}：${label(p.y)}`;
    tip.style.left = Math.min(Math.max(X(bi) * r.width / W, 60), r.width - 60) + 'px'; tip.style.top = Y(p.y) * r.height / H + 'px';
  };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}
function cumPts(list) {
  let c = 0;
  return list.map((m, i) => { c += m.rr || 0; return { x: `${i + 1}試合目`, y: c, c: `var(--${m.result})`, tip: `${i + 1}試合目 ${RES[m.result]}${m.map ? '・' + m.map : ''}：${sgn(m.rr || 0)}（計 ${sgn(c)}）` }; });
}

// ===== 画面：今日 =====
function renderSachi() {
  const el = $('#sachi'); if (!el) return;
  const r = S.lastReact;
  const clip = r && findClip(r.clip);
  let html;
  if (clip) html = duoHTML(clip.lines);
  else {
    const h = new Date().getHours();
    const greet = h < 5 ? '夜ふかしソロキューですね。目、つかれてませんか？' : h < 12 ? 'おはようございます。今日もソロキュー、となりにいますね。' : h < 18 ? 'こんにちは。キュー待ちのあいだ、ラジオもどうぞ。' : 'おかえりなさい。今日のセッション、はじめますか？';
    html = duoHTML([{ s: 'hinata', t: greet }, { s: 'mio', t: '試合が終わったら「試合を記録」から。10秒で終わります。' }]);
  }
  const notes = r && r.notes && r.notes.length ? r.notes.map(n => `<div class="note-line">${esc(n)}</div>`).join('') : '';
  el.innerHTML = `${html}${notes}${clip ? `<button class="iconbtn replay" aria-label="もう一回きく" data-act="replay">🔊</button>` : ''}`;
}
function renderToday() {
  const s = active();
  const v = $('#v-today');
  const today = S.matches.filter(m => dayKey(m.ts) === dayKey(Date.now())).sort(byTs);
  let sess;
  if (s) {
    const list = sessMatches(s.id);
    const w = list.filter(m => m.result === 'win').length, l = list.filter(m => m.result === 'loss').length;
    const net = sum(list, m => m.rr);
    const over = list.length >= s.cap;
    sess = `<div class="card">
      <div class="stats">
        <div class="stat"><div class="k">試合</div><div class="v">${list.length}<span class="muted small"> / ${s.cap}</span></div></div>
        <div class="stat"><div class="k">勝敗</div><div class="v">${w}-${l}</div></div>
        <div class="stat"><div class="k">RR</div><div class="v ${cls(net)}">${sgn(net)}</div></div>
      </div>
      ${s.goal ? `<div class="row small" style="margin-top:10px"><span class="muted">目標 +${s.goal}RR</span><div class="bar grow" role="progressbar" aria-valuenow="${Math.max(0, net)}" aria-valuemax="${s.goal}"><i style="width:${Math.min(100, Math.max(0, pct(net, s.goal)))}%"></i></div><span class="num">${Math.max(0, pct(net, s.goal))}%</span></div>` : ''}
      <div class="chart" id="sessChart"></div>
      ${over ? `<div class="banner">決めていた ${s.cap}試合に届きました。今日はここまでにしませんか？<div class="row" style="margin-top:8px"><button class="btn sm primary" data-act="end">ここで終える</button><button class="btn sm ghost" data-act="plus1">もう1試合だけ</button></div></div>` : ''}
      <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn sm ghost" data-act="end">セッションを終える</button></div>
    </div>`;
  } else {
    const rv = S.lastReview && S.sessions.find(x => x.id === S.lastReview);
    sess = `${rv && rv.review ? `<div class="card" id="review"><div class="row"><b class="grow">セッションの講評</b><span class="muted tiny">${dayLabel(dayKey(rv.start))} ${hm(rv.start)}〜${hm(rv.end)}</span></div>
      <div class="duo" style="margin-top:8px">${rv.review.map((t, i) => `<div class="say"><span class="face ${i % 2 ? 'mio' : 'hinata'}" aria-hidden="true">${i % 2 ? 'み' : 'ひ'}</span><div class="bubble">${esc(t)}</div></div>`).join('')}</div>
      <div class="chart" id="revChart"></div><div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn sm ghost" data-act="closeReview">閉じる</button></div></div>` : ''}
      <div class="card">
      <div class="field"><span>何試合まで？</span><span class="stepper"><button class="iconbtn" data-act="capm" aria-label="へらす">−</button><input id="capIn" type="number" inputmode="numeric" min="1" max="30" value="${S.settings.cap}" aria-label="試合数の上限"><button class="iconbtn" data-act="capp" aria-label="ふやす">＋</button></span></div>
      <div class="field"><span>RRの目標 <span class="muted small">（なくてもOK）</span></span><span class="row"><span class="muted">+</span><input id="goalIn" type="number" inputmode="numeric" min="0" max="200" placeholder="なし" style="width:84px;text-align:center"></span></div>
      <button class="btn primary block" style="margin-top:8px" data-act="start">セッション開始</button>
    </div>`;
  }
  const th = S.theme;
  const ts = th ? themeStat(th) : null;
  v.innerHTML = `
    <div class="card sachi-card" id="sachi" aria-live="polite" style="margin-top:6px"></div>
    <h2>今日のセッション</h2>
    ${sess}
    <h2>次の試合のテーマ<span class="sub">ひとつだけ</span></h2>
    <div class="card">
      <div class="chips" id="themeChips">${allThemes().map(t => `<button class="chip ${t === th ? 'on' : ''}" data-th="${esc(t)}" aria-pressed="${t === th}">${esc(t)}</button>`).join('')}<button class="chip add" data-act="addTheme">＋自分で</button></div>
      <p class="small muted" style="margin:8px 0 0">${th ? `「${esc(th)}」${ts.n ? `：これまで ${ts.n}回中 ${ts.o}回が○（${pct(ts.o, ts.n)}%）` : '：はじめてのテーマ'}。試合が終わったら ○△× を付けます。` : 'テーマなしでも記録できます。'}</p>
    </div>
    <div style="margin-top:14px"><button class="btn primary block big" data-act="record">＋ 試合を記録</button></div>
    <h2>今日の試合<span class="sub">${today.length}試合・${sgn(sum(today, m => m.rr))}RR</span></h2>
    <div class="card">${matchList(today.slice().reverse(), '今日はまだ記録がありません')}</div>`;
  renderSachi();
  if (s) drawLine($('#sessChart'), cumPts(sessMatches(s.id)), { empty: '記録すると、ここにRRの線が伸びていきます' });
  const rv = !s && S.lastReview && S.sessions.find(x => x.id === S.lastReview);
  if (rv && $('#revChart')) drawLine($('#revChart'), cumPts(sessMatches(rv.id)), { h: 120 });
  const pill = $('#sessPill');
  if (s) { const n = sessMatches(s.id).length; pill.className = 'pill on'; pill.innerHTML = `<span class="dot"></span>セッション中 ${n}/${s.cap}`; }
  else { pill.className = 'pill'; pill.textContent = 'セッション前'; }
}
function matchList(list, empty) {
  if (!list.length) return `<p class="muted small" style="margin:0">${esc(empty)}</p>`;
  return `<div class="mlist">${list.map(m => `<button class="m" data-edit="${m.id}">
    <span class="badge ${m.result}">${RES1[m.result]}</span>
    <span class="grow"><div class="t">${esc(m.agent || 'エージェント未選択')}${m.map ? '・' + esc(m.map) : ''}</div>
    <div class="tiny muted t">${dayLabel(dayKey(m.ts))} ${hm(m.ts)}${m.k != null ? `・${m.k}/${m.d ?? '-'}/${m.a ?? '-'}` : ''}${m.theme ? `・${esc(m.theme)} ${m.mark ? MARK[m.mark] : '−'}` : ''}</div></span>
    <span class="rr ${cls(m.rr)}">${sgn(m.rr || 0)}</span></button>`).join('')}</div>`;
}

// ===== 記録シート =====
let F = null;
function openSheet(editId) {
  const m = editId ? S.matches.find(x => x.id === editId) : null;
  F = m ? { ...m, editId } : { result: null, rr: null, rrTouched: false, agent: S.recentAgents[0] || '', map: '', theme: S.theme, mark: null, k: null, d: null, a: null };
  renderSheet();
}
function renderSheet() {
  const host = $('#sheetHost');
  if (!F) { host.innerHTML = ''; document.body.style.overflow = ''; return; }
  document.body.style.overflow = 'hidden';
  const recent = S.recentAgents.slice(0, 5);
  const agents = [...new Set(AGENTS.concat(S.matches.map(m => m.agent).filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'ja'));
  const maps = [...new Set(MAPS.concat(S.matches.map(m => m.map).filter(Boolean)))];
  host.innerHTML = `<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="試合を記録">
    <div class="row"><h3 class="grow">${F.editId ? '試合を直す' : '試合を記録'}</h3><button class="iconbtn" data-act="close" aria-label="閉じる">✕</button></div>
    <div class="lbl">結果</div>
    <div class="res3">${['win', 'loss', 'draw'].map(r => `<button class="res ${r} ${F.result === r ? 'on' : ''}" data-res="${r}" aria-pressed="${F.result === r}">${RES[r]}</button>`).join('')}</div>
    <div class="lbl">RRの増減</div>
    <div class="row wrapr"><span class="stepper"><button class="iconbtn" data-act="rrm" aria-label="1へらす">−</button><input id="rrIn" type="number" inputmode="numeric" value="${F.rr ?? ''}" placeholder="0" aria-label="RRの増減"><button class="iconbtn" data-act="rrp" aria-label="1ふやす">＋</button></span><button class="btn sm ghost" data-act="rrflip" aria-label="プラスとマイナスを入れかえ">±</button></div>
    <div class="chips" style="margin-top:8px">${(QUICK[F.result] || QUICK.win.concat(QUICK.loss.slice(0, 2))).map(q => `<button class="chip ${F.rr === q ? 'on' : ''}" data-rr="${q}">${sgn(q)}</button>`).join('')}</div>
    <div class="lbl">エージェント</div>
    <div class="chips">${recent.map(a => `<button class="chip ${F.agent === a ? 'on' : ''}" data-agent="${esc(a)}">${esc(a)}</button>`).join('')}
      <select id="agentSel" aria-label="エージェントを選ぶ" style="min-height:36px;border-radius:999px"><option value="">${recent.length ? 'ほか…' : '選ぶ…'}</option>${agents.map(a => `<option ${F.agent === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}<option value="__new">＋自分で入力</option></select></div>
    <div class="lbl">マップ</div>
    <div class="grid3">${maps.map(p => `<button class="chip ${F.map === p ? 'on' : ''}" data-map="${esc(p)}">${esc(p)}</button>`).join('')}</div>
    <div class="lbl">テーマ${F.theme ? `「${esc(F.theme)}」はできた？` : ''}</div>
    ${F.theme ? `<div class="marks">${['o', 'm', 'x'].map(k => `<button class="mark ${k} ${F.mark === k ? 'on' : ''}" data-mark="${k}" aria-pressed="${F.mark === k}"><b>${MARK[k]}</b>${MARKW[k]}</button>`).join('')}</div>` :
      `<p class="small muted" style="margin:0">テーマなし（「今日」の画面で選べます）</p>`}
    <details ${F.k != null ? 'open' : ''}><summary>キル / デス / アシスト（なくてもOK）</summary>
      <div class="kda"><label>キル<input id="kIn" type="number" inputmode="numeric" min="0" value="${F.k ?? ''}"></label><label>デス<input id="dIn" type="number" inputmode="numeric" min="0" value="${F.d ?? ''}"></label><label>アシスト<input id="aIn" type="number" inputmode="numeric" min="0" value="${F.a ?? ''}"></label></div></details>
    <div class="savebar"><button class="btn primary block big" data-act="saveMatch" ${F.result ? '' : 'disabled'}>${F.result ? (F.editId ? '直す' : '記録する') : '結果を選んでね'}</button></div>
    ${F.editId ? `<button class="btn ghost block" style="margin-top:8px;color:var(--loss)" data-act="delMatch">この試合を消す</button>` : ''}
  </div></div>`;
  const rr = $('#rrIn'); rr.addEventListener('input', () => { F.rr = rr.value === '' ? null : Math.round(+rr.value); F.rrTouched = true; });
  $('#agentSel').addEventListener('change', e => {
    let v = e.target.value;
    if (v === '__new') { v = (prompt('エージェント名') || '').trim().slice(0, 20); }
    if (v) { F.agent = v; } renderSheet();
  });
  for (const id of ['k', 'd', 'a']) $(`#${id}In`).addEventListener('input', e => { F[id] = e.target.value === '' ? null : Math.max(0, Math.round(+e.target.value)); });
}
function saveSheet() {
  if (!F || !F.result) return;
  const rr = F.rr ?? 0;
  if (F.editId) {
    const m = S.matches.find(x => x.id === F.editId);
    Object.assign(m, { result: F.result, rr, agent: F.agent, map: F.map, theme: F.theme, mark: F.theme ? F.mark : null, k: F.k, d: F.d, a: F.a });
    save(); F = null; renderSheet(); renderAll(); toast('直しました');
    return;
  }
  const s = active();
  const m = { id: uid(), ts: Date.now(), result: F.result, rr, agent: F.agent, map: F.map, theme: F.theme || null, mark: F.theme ? F.mark : null,
    k: F.k, d: F.d, a: F.a, session: s ? s.id : null, src: 'manual', extId: null };
  F = null; renderSheet();
  addMatch(m);
  renderAll();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ===== 画面：戦績 =====
let period = '7';
function renderStats() {
  const v = $('#v-stats');
  const now = Date.now();
  const days = { today: 1, '7': 7, '30': 30, all: 99999 }[period];
  const todayK = dayKey(now);
  const keys = new Set(); for (let i = 0; i < Math.min(days, 400); i++) keys.add(dayKey(now - i * 864e5));
  const list = S.matches.filter(m => period === 'all' || keys.has(dayKey(m.ts))).sort(byTs);
  const w = list.filter(m => m.result === 'win').length, l = list.filter(m => m.result === 'loss').length;
  const net = sum(list, m => m.rr);
  const kd = list.filter(m => m.k != null && m.d != null);
  const name = S.settings.riotName, tag = S.settings.riotTag;
  const tUrl = name && tag ? `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(name)}%23${encodeURIComponent(tag)}/overview` : '';
  // テーマ
  const themes = {};
  for (const m of S.matches) if (m.theme && m.mark) { const t = themes[m.theme] = themes[m.theme] || { o: 0, m: 0, x: 0, n: 0 }; t[m.mark]++; t.n++; }
  const trows = Object.entries(themes).sort((a, b) => b[1].n - a[1].n);
  // マップ・エージェント
  const group = key => { const g = {}; for (const m of list) if (m[key]) { const x = g[m[key]] = g[m[key]] || { w: 0, n: 0, rr: 0 }; x.n++; x.rr += m.rr || 0; if (m.result === 'win') x.w++; } return Object.entries(g).sort((a, b) => b[1].n - a[1].n).slice(0, 6); };
  const grp = (rows) => rows.length ? rows.map(([k, x]) => `<div class="trow"><div class="row"><span class="grow">${esc(k)}</span><span class="small muted num">${x.n}試合・勝率 ${pct(x.w, x.n)}%</span><span class="small num ${cls(x.rr)}" style="width:52px;text-align:right">${sgn(x.rr)}</span></div><div class="bar" style="margin-top:4px"><i style="width:${pct(x.w, x.n)}%"></i></div></div>`).join('') : '<p class="muted small" style="margin:0">まだありません</p>';
  v.innerHTML = `
    <div class="card" style="margin-top:6px">
      ${tUrl ? `<a class="btn block primary" href="${tUrl}" target="_blank" rel="noopener noreferrer">tracker.gg でくわしく見る ↗</a><p class="tiny muted" style="margin:6px 0 0">${esc(name)}#${esc(tag)} のページを開きます（アプリからは何も送りません）</p>`
      : `<button class="btn block ghost" data-tab-go="settings">設定で Riot ID を入れると tracker.gg を開けます</button>`}
    </div>
    <div class="row" style="margin-top:16px"><div class="seg" role="tablist">${[['today', '今日'], ['7', '7日'], ['30', '30日'], ['all', '全部']].map(([k, t]) => `<button class="${period === k ? 'on' : ''}" data-period="${k}" role="tab" aria-selected="${period === k}">${t}</button>`).join('')}</div></div>
    <div class="stats" style="margin-top:10px">
      <div class="stat"><div class="k">試合</div><div class="v">${list.length}</div></div>
      <div class="stat"><div class="k">勝率</div><div class="v">${list.length ? pct(w, list.length) + '%' : '−'}</div></div>
      <div class="stat"><div class="k">RR</div><div class="v ${cls(net)}">${sgn(net)}</div></div>
    </div>
    <p class="small muted" style="margin:6px 2px 0">${w}勝 ${l}敗 ${list.length - w - l}分${kd.length ? `・キル/デス ${(sum(kd, m => m.k) / Math.max(1, sum(kd, m => m.d))).toFixed(2)}` : ''}</p>
    <h2>${period === 'today' ? '今日のRR' : '日ごとのRR'}<span class="sub">${period === 'today' ? '試合ごとの合計' : '期間のはじめからの合計'}</span></h2>
    <div class="card"><div class="chart" id="dayChart"></div></div>
    <h2>テーマの達成率<span class="sub">全期間</span></h2>
    <div class="card">${trows.length ? trows.map(([t, x]) => `<div class="trow"><div class="row"><span class="grow">${esc(t)}</span><b class="num">${pct(x.o, x.n)}%</b></div>
      <div class="stack" aria-hidden="true">${['o', 'm', 'x'].map(k => x[k] ? `<i class="${k}" style="flex:${x[k]}"></i>` : '').join('')}</div>
      <div class="tiny muted">○${x.o}　△${x.m}　×${x.x}（${x.n}試合）</div></div>`).join('') : '<p class="muted small" style="margin:0">テーマを選んで記録すると、ここに達成率が出ます</p>'}</div>
    <h2>マップ別</h2><div class="card">${grp(group('map'))}</div>
    <h2>エージェント別</h2><div class="card">${grp(group('agent'))}</div>
    <h2>試合の一覧<span class="sub">タップで直せます</span></h2>
    <div class="card">${matchList(list.slice().reverse().slice(0, 60), 'この期間の記録はありません')}</div>`;
  let pts;
  if (period === 'today') pts = cumPts(list.filter(m => dayKey(m.ts) === todayK));
  else {
    const by = {}; for (const m of list) { const k = dayKey(m.ts); by[k] = (by[k] || 0) + (m.rr || 0); }
    let c = 0; pts = Object.keys(by).sort().map(k => { c += by[k]; return { x: dayLabel(k), y: c, tip: `${dayLabel(k)}：その日 ${sgn(by[k])}（計 ${sgn(c)}）` }; });
  }
  drawLine($('#dayChart'), pts);
}

// ===== 画面：ラジオ =====
let radioIdx = -1;
function fmtSec(s) { s = Math.round(s || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function renderRadio() {
  const v = $('#v-radio');
  const eps = (LINES && LINES.radio) || [];
  const cur = eps[radioIdx];
  v.innerHTML = `
    <div class="card" style="margin-top:6px;background:var(--accent-soft);border-color:transparent"><b>ラウンド中は止めておこう</b><div class="small">足音が聞こえるように。キュー待ち・エージェント選択・試合のあいだに、1本1分くらいで聞けます。</div></div>
    <div class="card player" style="margin-top:10px">
      <div class="tiny muted">${cur ? esc(cur.when) : 'ひなた と みお のおしゃべり'}</div>
      <div class="ttl">${cur ? esc(cur.title) : 'まだ再生していません'}</div>
      <div class="prog"><i id="rprog"></i></div>
      <div class="row tiny muted"><span id="rpos">0:00</span><span class="grow"></span><span id="rdur">${cur ? fmtSec((DUR[cur.id] || {}).sec) : ''}</span></div>
      <div class="row" style="margin-top:8px"><button class="btn primary grow" data-act="rplay">${radioEl.paused ? '▶ 再生' : '❚❚ 止める'}</button><button class="btn" data-act="rnext" aria-label="次の回">次 ⏭</button></div>
      <label class="row small" style="margin-top:10px"><input type="checkbox" id="rauto" ${S.settings.radioAuto ? 'checked' : ''}> 終わったら次の回へ</label>
    </div>
    <h2>番組の一覧<span class="sub">${eps.length}本</span></h2>
    <div class="card">${eps.map((e, i) => `<button class="ep ${i === radioIdx ? 'on' : ''}" data-ep="${i}"><span class="n">${i + 1}</span><span class="grow"><div class="t">${esc(e.title)}</div></span><span class="tag">${esc(e.when)}</span><span class="tiny muted num">${fmtSec((DUR[e.id] || {}).sec)}</span></button>`).join('')}</div>`;
  $('#rauto').addEventListener('change', e => { S.settings.radioAuto = e.target.checked; save(); });
  updateRadioProg();
}
function playRadio(i) {
  const eps = (LINES && LINES.radio) || []; if (!eps.length) return;
  radioIdx = ((i % eps.length) + eps.length) % eps.length;
  const e = eps[radioIdx];
  sfx.pause();
  radioEl.src = `audio/${e.id}.mp3`; radioEl.volume = S.settings.volume;
  const p = radioEl.play(); if (p) p.catch(() => {});
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.metadata = new MediaMetadata({ title: e.title, artist: '幸とソロQ ラジオ', album: 'VOICEVOX:春日部つむぎ、VOICEVOX:冥鳴ひまり' }); } catch (err) { }
  }
  renderRadio();
}
function updateRadioProg() {
  const bar = $('#rprog'); if (!bar) return;
  const d = radioEl.duration || 0;
  bar.style.width = d ? (radioEl.currentTime / d * 100) + '%' : '0';
  const pos = $('#rpos'); if (pos) pos.textContent = fmtSec(radioEl.currentTime);
}
radioEl.addEventListener('timeupdate', updateRadioProg);
radioEl.addEventListener('ended', () => { if (S.settings.radioAuto) playRadio(radioIdx + 1); else renderRadio(); });
radioEl.addEventListener('play', () => { if ($('#v-radio').classList.contains('on')) renderRadio(); });
radioEl.addEventListener('pause', () => { if ($('#v-radio').classList.contains('on')) renderRadio(); });
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('nexttrack', () => playRadio(radioIdx + 1));
    navigator.mediaSession.setActionHandler('play', () => radioEl.play());
    navigator.mediaSession.setActionHandler('pause', () => radioEl.pause());
  } catch (e) { }
}

// ===== 画面：設定 =====
function renderSettings() {
  const st = S.settings;
  const src = window.SoloQSource || {};
  $('#v-settings').innerHTML = `
    <h2>Riot ID<span class="sub">tracker.gg を開くときだけ使う</span></h2>
    <div class="card">
      <div class="row"><input id="riotName" class="grow" placeholder="名前" value="${esc(st.riotName)}" autocomplete="off" aria-label="Riot ID の名前"><span class="muted">#</span><input id="riotTag" placeholder="タグ" value="${esc(st.riotTag)}" style="width:90px" autocomplete="off" aria-label="タグ"></div>
      <p class="tiny muted" style="margin:6px 0 0">この端末の中だけに保存します。どこにも送りません。</p>
    </div>
    <h2>幸の声</h2>
    <div class="card">
      <div class="field"><label for="voiceOn">記録したあとに声で反応する</label><input type="checkbox" id="voiceOn" ${st.voice ? 'checked' : ''}></div>
      <div class="field"><label for="vol">音量</label><input type="range" id="vol" min="0.1" max="1" step="0.05" value="${st.volume}" style="width:150px"></div>
      <div class="field"><span class="small muted">ラジオを流しているあいだは、反応の声は出しません（文字だけ）。</span><button class="btn sm ghost" data-act="testVoice">試しに聞く</button></div>
    </div>
    <h2>見た目と区切り</h2>
    <div class="card">
      <div class="field"><span>色</span><div class="seg">${[['system', '自動'], ['dark', 'ダーク'], ['light', 'ライト']].map(([k, t]) => `<button class="${st.look === k ? 'on' : ''}" data-look="${k}">${t}</button>`).join('')}</div></div>
      <div class="field"><label for="dayStart">1日の区切り</label><select id="dayStart">${[0, 3, 4, 5, 6, 7, 8].map(h => `<option value="${h}" ${st.dayStart === h ? 'selected' : ''}>${h}時</option>`).join('')}</select></div>
    </div>
    <h2>戦績の取り込み</h2>
    <div class="card">
      <div class="field"><span>いまの方法</span><b>${esc(src.label || '手入力のみ')}</b></div>
      <p class="tiny muted" style="margin:4px 0 8px">自動の取り込みはまだありません（外部のサービスにはつながっていません）。</p>
      <button class="btn sm ghost" data-act="sync" ${src.enabled ? '' : 'disabled'}>いま取り込む</button>
    </div>
    <h2>データ</h2>
    <div class="card">
      <p class="small muted" style="margin:0 0 8px">記録は ${S.matches.length}試合・${S.sessions.length}セッション。ブラウザのデータを消すと消えるので、ときどき書き出しておくと安心です。</p>
      <div class="row wrapr"><button class="btn sm" data-act="export">書き出す（JSON）</button><button class="btn sm ghost" data-act="import">読み込む</button><input type="file" id="impFile" accept="application/json,.json" hidden></div>
    </div>
    <h2>クレジット</h2>
    <div class="card small">音声：VOICEVOX:春日部つむぎ、VOICEVOX:冥鳴ひまり<br><span class="muted">ゲームの名前は説明のために使っています。Riot Games とは関係のない、個人のファンメイドのツールです。</span></div>`;
  const saveRiot = () => { S.settings.riotName = $('#riotName').value.trim().slice(0, 32); S.settings.riotTag = $('#riotTag').value.trim().replace(/^#/, '').slice(0, 8); save(); };
  $('#riotName').addEventListener('change', saveRiot); $('#riotTag').addEventListener('change', saveRiot);
  $('#voiceOn').addEventListener('change', e => { S.settings.voice = e.target.checked; save(); });
  $('#vol').addEventListener('input', e => { S.settings.volume = +e.target.value; sfx.volume = radioEl.volume = S.settings.volume; save(); });
  $('#dayStart').addEventListener('change', e => { S.settings.dayStart = +e.target.value; save(); });
  $('#impFile').addEventListener('change', importFile);
}
function applyLook() {
  const l = S.settings.look;
  if (l === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', l);
}
function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `soloq-${dayKey(Date.now())}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importFile(e) {
  const f = e.target.files[0]; if (!f) return;
  f.text().then(t => {
    const d = JSON.parse(t);
    if (!d || !Array.isArray(d.matches) || !Array.isArray(d.sessions)) throw new Error('形がちがう');
    if (!confirm(`${d.matches.length}試合の記録を読み込みます。いまの記録（${S.matches.length}試合）は置きかわります。いいですか？`)) return;
    localStorage.setItem(KEY, JSON.stringify(d)); load(); applyLook(); renderAll(); toast('読み込みました');
  }).catch(() => toast('読み込めませんでした（このアプリで書き出したJSONを選んでね）'));
}

// ===== 全体 =====
let tab = 'today';
function renderAll() {
  renderToday();
  if (tab === 'stats') renderStats();
  if (tab === 'radio') renderRadio();
  if (tab === 'settings') renderSettings();
}
function go(t) {
  tab = t;
  document.querySelectorAll('section.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + t));
  document.querySelectorAll('nav.tabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-current', b.dataset.tab === t ? 'page' : 'false'); });
  renderAll();
  window.scrollTo(0, 0);
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-tab-go],[data-act],[data-th],[data-edit],[data-res],[data-rr],[data-agent],[data-map],[data-mark],[data-period],[data-ep],[data-look]');
  if (!t) return;
  const d = t.dataset;
  if (d.tab) return go(d.tab);
  if (d.tabGo) return go(d.tabGo);
  if (d.th !== undefined && !d.act) { S.theme = S.theme === d.th ? null : d.th; save(); return renderToday(); }
  if (d.edit) return openSheet(d.edit);
  if (d.res) { F.result = d.res; if (!F.rrTouched && !F.editId) F.rr = S.lastRR[d.res]; return renderSheet(); }
  if (d.rr) { F.rr = +d.rr; F.rrTouched = true; return renderSheet(); }
  if (d.agent) { F.agent = d.agent; return renderSheet(); }
  if (d.map) { F.map = F.map === d.map ? '' : d.map; return renderSheet(); }
  if (d.mark) { F.mark = F.mark === d.mark ? null : d.mark; return renderSheet(); }
  if (d.period) { period = d.period; return renderStats(); }
  if (d.ep) { const i = +d.ep; if (i === radioIdx && !radioEl.paused) radioEl.pause(); else if (i === radioIdx && radioEl.src) radioEl.play().catch(() => {}); else playRadio(i); return; }
  if (d.look) { S.settings.look = d.look; save(); applyLook(); return renderSettings(); }
  const a = d.act;
  if (a === 'scrim') { if (e.target === t) { F = null; renderSheet(); } return; }
  if (a === 'close') { F = null; return renderSheet(); }
  if (a === 'record') return openSheet();
  if (a === 'saveMatch') return saveSheet();
  if (a === 'delMatch') { if (confirm('この試合の記録を消しますか？（もとに戻せません）')) { S.matches = S.matches.filter(m => m.id !== F.editId); save(); F = null; renderSheet(); renderAll(); toast('消しました'); } return; }
  if (a === 'rrm' || a === 'rrp') { F.rr = (F.rr ?? 0) + (a === 'rrp' ? 1 : -1); F.rrTouched = true; $('#rrIn').value = F.rr; return; }
  if (a === 'rrflip') { F.rr = -(F.rr ?? 0); F.rrTouched = true; $('#rrIn').value = F.rr; return; }
  if (a === 'capm' || a === 'capp') { const i = $('#capIn'); i.value = Math.min(30, Math.max(1, (+i.value || 5) + (a === 'capp' ? 1 : -1))); return; }
  if (a === 'start') { const cap = Math.min(30, Math.max(1, Math.round(+$('#capIn').value || 5))); const g = Math.round(+$('#goalIn').value || 0); return startSession(cap, g > 0 ? g : null); }
  if (a === 'end') { if (confirm('今日のセッションを終えて、講評を見ますか？')) endSession(); return; }
  if (a === 'plus1') { const s = active(); if (s) { s.cap += 1; save(); toast(`上限を ${s.cap}試合にしました。無理せずね`); renderToday(); } return; }
  if (a === 'closeReview') { S.lastReview = null; save(); return renderToday(); }
  if (a === 'replay') { const r = S.lastReact; const c = r && findClip(r.clip); if (c) { if (!radioEl.paused) radioEl.pause(); playClip(c); } return; }
  if (a === 'addTheme') {
    const v = (prompt('テーマ（短く。例：ヘッドラインを意識）') || '').trim().slice(0, 24);
    if (v) { if (!allThemes().includes(v)) S.customThemes.push(v); S.theme = v; save(); renderToday(); }
    return;
  }
  if (a === 'rplay') { if (radioIdx < 0) playRadio(0); else if (radioEl.paused) radioEl.play().catch(() => {}); else radioEl.pause(); return; }
  if (a === 'rnext') return playRadio(radioIdx + 1);
  if (a === 'testVoice') { const c = (LINES.reactions.win || [])[0]; if (c) { radioEl.pause(); playClip(c); } return; }
  if (a === 'export') return exportData();
  if (a === 'import') return $('#impFile').click();
  if (a === 'sync') { syncFromSource().then(n => toast(`${n}試合を取り込みました`)).catch(() => toast('取り込めませんでした')); return; }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && F) { F = null; renderSheet(); } });
let rsT; addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(renderAll, 200); });

// テスト・のちの拡張用
window.__soloq = { get S() { return S; }, load, save, addMatch, afterMatch, importMatches, syncFromSource, startSession, endSession, buildReview, openSheet, saveSheet, get F() { return F; }, go, dayKey, themeStat };

(async function init() {
  load(); applyLook();
  await loadLines();
  renderAll();
})();
