// 画面と操作。タイトル → ログイン → メニュー → 対局 → リザルト。
import { CARD, MONTH_PLANTS, TYPE_LABEL, cardImage, sortCards } from './cards.js?v=20261122-2024';
import { YAKU_TABLE, RULE_NOTES, finalPoints, scoreCaptured, nearYaku } from './scoring.js?v=20261122-2024';
import * as E from './engine.js?v=20261122-2024';
import * as CPU from './cpu.js?v=20261122-2024';
import * as S from './sound.js?v=20261122-2024';
import * as O from './online.js?v=20261122-2024';
import { VERSION } from './version.js?v=20261122-2024';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const screenEl = $('#screen');
const overlayEl = $('#overlay');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- 設定(この端末に保存)
const PREF_KEY = 'kitsuen-hanafuda-prefs';
const prefs = {
  se: true, seVol: 0.7, bgm: false, bgmVol: 0.4,
  tapMode: 'double', // 'double' = 選んでもう一度タップで出す / 'single' = 1回で出す
  highlight: true,
  guestName: '', guestIcon: 'tsuru',
  lastSettings: { months: 12, sakeRule: true, guide: true },
};
try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { /* 使えなくても遊べる */ }
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* noop */ }
  S.setSoundSettings(prefs);
}
S.setSoundSettings(prefs);

// ---------------------------------------------------------------- 部品
const ICONS = {
  ino: { label: '猪', card: '07-tane' },
  shika: { label: '鹿', card: '10-tane' },
  cho: { label: '蝶', card: '06-tane' },
  tsuru: { label: '鶴', card: '01-hikari' },
};

function iconHTML(icon, size = 44) {
  const ic = ICONS[icon] || ICONS.tsuru;
  return `<div class="icon ${icon}" style="--s:${size}px;background-image:url(${cardImage(ic.card)})">${ic.label}</div>`;
}

function cardHTML(id, cls = '') {
  const c = CARD[id];
  return `<div class="card t-${c.type} ${cls}" data-id="${id}"><div class="alt"><b>${MONTH_PLANTS[c.month]}</b><i>${esc(c.name)}</i><s>${TYPE_LABEL[c.type]}</s></div><img src="${cardImage(id)}" alt="${esc(c.name)}" draggable="false"></div>`;
}
const backHTML = () => '<div class="card back"></div>';

// 画像が無ければ代わりの絵を見せる
document.addEventListener('error', (e) => {
  if (e.target.tagName === 'IMG' && e.target.closest('.card')) e.target.remove();
}, true);
// 画像があるかを1枚だけ確かめて、アイコンの文字を消す
const probe = new Image();
probe.onload = () => document.body.classList.add('imgs');
probe.src = cardImage('01-hikari');

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

function show(html) {
  closeOverlay();
  screenEl.innerHTML = html;
  window.scrollTo(0, 0);
}
function openOverlay(html, { dismiss = true } = {}) {
  overlayEl.classList.remove('peek');
  overlayEl.innerHTML = `<div class="ov-bg"></div>${html}`;
  if (dismiss) $('.ov-bg', overlayEl).onclick = closeOverlay;
}
function closeOverlay() { overlayEl.classList.remove('peek'); overlayEl.innerHTML = ''; }

function pageHead(title, back) {
  return `<div class="page-head"><button class="back" data-back aria-label="戻る">‹</button><h2>${title}</h2></div>`;
}
function bindBack(fn) { const b = $('[data-back]'); if (b) b.onclick = fn; }

document.addEventListener('pointerdown', () => S.unlock(), { capture: true });

// ---------------------------------------------------------------- ログイン状態
const app = {
  user: null, // Supabase のユーザー
  profile: null, // { nickname, icon }
  guest: false, // ログインせずに遊んでいる
  roomParam: new URLSearchParams(location.search).get('room'),
};

function myName() { return app.guest ? (prefs.guestName || 'あなた') : app.profile?.nickname || 'あなた'; }
function myIcon() { return app.guest ? prefs.guestIcon : app.profile?.icon || 'tsuru'; }

// ---------------------------------------------------------------- タイトル
function showTitle() {
  const fan = ['01-hikari', '03-hikari', '08-hikari', '11-hikari', '12-hikari'];
  show(`
    <section class="title">
      <div class="title-fan">${fan.map((id, i) => cardHTML(id).replace('class="card', `style="transform:translateX(-50%) rotate(${(i - 2) * 14}deg)" class="card`)).join('')}</div>
      <div class="title-logo"><h1>喫煙所<br><span>花札</span></h1><p>こいこい</p></div>
      <button class="btn shu blink" id="start">ゲームスタート</button>
    </section>`);
  $('#start').onclick = async () => {
    S.pachi();
    await afterStart();
  };
}

async function afterStart() {
  await supabaseReady;
  if (O.isOnlineReady()) {
    app.user = await O.currentUser();
    if (app.user) {
      try { app.profile = await O.getProfile(app.user.id); } catch (e) { app.profile = null; }
      if (!app.profile) return showProfile(false);
      return goMenu();
    }
  }
  if (app.guest) return goMenu();
  showLogin();
}

// ---------------------------------------------------------------- ログイン
function showLogin() {
  const online = O.isOnlineReady();
  show(`
    <section class="page">
      <div class="menu-logo">喫煙所花札</div>
      <div class="panel stack">
        <h3>ログイン</h3>
        <p class="muted" style="color:var(--ink-soft);margin:0">友達との対戦と戦績の記録には、Googleアカウントでのログインが必要です。</p>
        ${online ? '<button class="btn shu" id="google">Googleでログイン</button>'
          : '<p style="margin:0;color:var(--shu-dark);font-size:13px">いまはオンラインの準備ができていないため、CPU対戦だけ遊べます。</p>'}
      </div>
      <button class="btn ghost" id="guest">ログインせずにCPUと遊ぶ</button>
    </section>`);
  if (online) {
    $('#google').onclick = async () => {
      try { await O.signInWithGoogle(); } catch (e) { toast('ログインできませんでした: ' + e.message); }
    };
  }
  $('#guest').onclick = () => {
    app.guest = true;
    if (!prefs.guestName) return showProfile(false);
    goMenu();
  };
}

// ---------------------------------------------------------------- ニックネームとアイコン
function showProfile(isEdit) {
  let icon = myIcon();
  const name = app.guest ? prefs.guestName : app.profile?.nickname || '';
  show(`
    <section class="page">
      ${isEdit ? pageHead('プロフィール') : '<div class="menu-logo">はじめまして</div>'}
      <div class="panel stack">
        <h3>ニックネーム</h3>
        <input type="text" id="nick" maxlength="10" placeholder="1〜10文字" value="${esc(name)}">
        <p style="margin:0;font-size:12px;color:var(--ink-soft)">対戦相手にはこの名前が表示されます。</p>
        <h3 style="margin-top:6px">アイコン</h3>
        <div class="icon-pick">${Object.entries(ICONS).map(([k, v]) => `<button data-icon="${k}" class="${k === icon ? 'on' : ''}">${iconHTML(k, 56)}<small>${v.label}</small></button>`).join('')}</div>
      </div>
      <button class="btn shu" id="save">${isEdit ? '保存する' : 'はじめる'}</button>
    </section>`);
  bindBack(showSettings);
  $$('[data-icon]').forEach((b) => {
    b.onclick = () => {
      icon = b.dataset.icon;
      $$('[data-icon]').forEach((x) => x.classList.toggle('on', x === b));
    };
  });
  $('#save').onclick = async () => {
    const nick = $('#nick').value.trim();
    if (nick.length < 1 || nick.length > 10) return toast('ニックネームは1〜10文字です');
    if (app.guest) {
      prefs.guestName = nick;
      prefs.guestIcon = icon;
      savePrefs();
    } else {
      try { app.profile = await O.saveProfile(app.user.id, nick, icon); } catch (e) { return toast('保存できませんでした: ' + e.message); }
    }
    if (isEdit) { toast('保存しました'); showSettings(); } else goMenu();
  };
}

// ---------------------------------------------------------------- メニュー
async function goMenu() {
  // 招待リンクから来た場合は、そのまま部屋に入る
  if (app.roomParam && !app.guest && app.user) {
    const code = app.roomParam;
    app.roomParam = null;
    history.replaceState(null, '', location.pathname);
    return doJoin(code);
  }
  showMenu();
}

let cachedMatches = null;
async function loadMatches() {
  if (app.guest || !app.user) return [];
  try { cachedMatches = await O.listMatches(); } catch (e) { cachedMatches = cachedMatches || []; }
  return cachedMatches;
}

function statsOf(matches) {
  const uid = app.user?.id;
  let w = 0; let l = 0; let d = 0;
  for (const m of matches) {
    const me = m.player0 === uid ? 0 : 1;
    const diff = m.scores[me] - m.scores[1 - me];
    if (diff > 0) w += 1; else if (diff < 0) l += 1; else d += 1;
  }
  return { n: matches.length, w, l, d };
}

// 月(1回戦)ごとの勝ち負け。中断で残らなかった月は数えない
function monthStatsOf(matches, uid) {
  let w = 0; let l = 0; let d = 0;
  for (const m of matches) {
    const me = m.player0 === uid ? 0 : 1;
    for (const h of m.history || []) {
      if (h.aborted) continue;
      if (h.winner === null || h.winner === undefined) d += 1;
      else if (h.winner === me) w += 1;
      else l += 1;
    }
  }
  return { n: w + l + d, w, l, d };
}

function wlText(st) {
  return `${st.w}勝${st.l}敗${st.d ? st.d + '分' : ''}`;
}

// 対局の終わった日時(今年なら年は省く)
function whenText(iso) {
  const dt = new Date(iso);
  const hm = `${dt.getHours()}:${String(dt.getMinutes()).padStart(2, '0')}`;
  const md = `${dt.getMonth() + 1}/${dt.getDate()}`;
  return dt.getFullYear() === new Date().getFullYear() ? `${md} ${hm}` : `${dt.getFullYear()}/${md} ${hm}`;
}

async function showMenu() {
  const record = app.guest ? 'ゲスト(CPU対戦のみ)' : '戦績を読み込み中…';
  show(`
    <section class="page">
      <div class="menu-logo">喫煙所花札</div>
      <div class="panel me-card">${iconHTML(myIcon(), 58)}<div><div class="name">${esc(myName())}</div><div class="rec" id="rec">${record}</div></div></div>
      <div id="resume"></div>
      <div class="stack">
        <button class="btn shu" id="play">ゲームスタート</button>
        <button class="btn" id="hist" ${app.guest ? 'disabled' : ''}>戦績</button>
        <button class="btn ghost" id="set">設定</button>
      </div>
    </section>`);
  $('#play').onclick = showStartMenu;
  $('#hist').onclick = showHistory;
  $('#set').onclick = showSettings;
  if (!app.guest && app.user) {
    const ms = await loadMatches();
    const st = statsOf(ms);
    const rec = $('#rec');
    if (rec) rec.textContent = `通算 ${st.n}戦 ${st.w}勝 ${st.l}敗${st.d ? ` ${st.d}分` : ''}`;
    const active = await O.findActiveRoom(app.user.id);
    const box = $('#resume');
    if (active && box) {
      box.innerHTML = `<button class="btn" id="back-room">対局中の部屋に戻る(${active.code})</button>`;
      $('#back-room').onclick = () => enterRoom(active);
    }
  }
}

function showStartMenu() {
  const offline = app.guest || !app.user;
  show(`
    <section class="page">
      ${pageHead('ゲームスタート')}
      <div class="stack">
        <button class="btn shu" id="create" ${offline ? 'disabled' : ''}>部屋を作る</button>
        <button class="btn" id="join" ${offline ? 'disabled' : ''}>部屋コードで入る</button>
        <button class="btn" id="watch" ${offline ? 'disabled' : ''}>観戦する</button>
        <button class="btn ghost" id="cpu">CPUと対戦</button>
        ${offline ? '<p class="muted">ログインすると友達と対戦できます。</p>' : ''}
      </div>
    </section>`);
  bindBack(showMenu);
  $('#create').onclick = () => showRoomSettings('online');
  $('#join').onclick = showJoin;
  $('#watch').onclick = showWatch;
  $('#cpu').onclick = () => showRoomSettings('cpu');
}

// ---------------------------------------------------------------- 部屋の設定
function showRoomSettings(mode) {
  const st = { ...prefs.lastSettings };
  st.guide = st.guide !== false;
  const draw = () => {
    show(`
      <section class="page">
        ${pageHead(mode === 'cpu' ? 'CPUと対戦' : '部屋を作る')}
        <div class="panel stack">
          <h3>対局の長さ</h3>
          <div class="choices">${[1, 3, 6, 12].map((m) => `<button data-m="${m}" class="${st.months === m ? 'on' : ''}">${m}ヶ月</button>`).join('')}</div>
          <div class="setting-row" style="margin-top:6px">
            <label>小野木戸口ルール(月見花見)<small>ふだん1点。他の役が2点以上あれば5点</small></label>
            <button class="toggle ${st.sakeRule ? 'on' : ''}" id="sake" aria-label="小野木戸口ルール"></button>
          </div>
          <div class="setting-row">
            <label>ガイド<small>「赤短まであと1枚」のように、もう少しでできる役を表示</small></label>
            <button class="toggle ${st.guide ? 'on' : ''}" id="guide" aria-label="ガイド"></button>
          </div>
        </div>
        <button class="btn shu" id="go">${mode === 'cpu' ? '対局開始' : '部屋を作る'}</button>
      </section>`);
    bindBack(showStartMenu);
    $$('[data-m]').forEach((b) => { b.onclick = () => { st.months = Number(b.dataset.m); draw(); }; });
    $('#sake').onclick = () => { st.sakeRule = !st.sakeRule; draw(); };
    $('#guide').onclick = () => { st.guide = !st.guide; draw(); };
    $('#go').onclick = async () => {
      prefs.lastSettings = st;
      savePrefs();
      if (mode === 'cpu') return startCpuGame(st);
      try {
        const room = await O.createRoom(app.user.id, st);
        enterRoom(room);
      } catch (e) { toast(e.message); }
    };
  };
  draw();
}

function showJoin() {
  show(`
    <section class="page">
      ${pageHead('部屋コードで入る')}
      <div class="panel stack">
        <h3>6桁の部屋コード</h3>
        <input inputmode="numeric" class="code-input" id="code" maxlength="6" placeholder="000000" autocomplete="off">
      </div>
      <button class="btn shu" id="go">入る</button>
    </section>`);
  bindBack(showStartMenu);
  const inp = $('#code');
  inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); };
  $('#go').onclick = () => {
    if (!/^\d{6}$/.test(inp.value)) return toast('6桁の数字を入れてください');
    doJoin(inp.value);
  };
}

function showWatch() {
  show(`
    <section class="page">
      ${pageHead('観戦する')}
      <div class="panel stack">
        <h3>見たい部屋の6桁コード</h3>
        <input inputmode="numeric" class="code-input" id="code" maxlength="6" placeholder="000000" autocomplete="off">
        <p class="muted" style="margin:0;color:var(--ink-soft)">対局している人の部屋コードと同じ番号です。手札は伏せたままで、場と取り札だけ見られます。</p>
      </div>
      <button class="btn shu" id="go">観戦する</button>
    </section>`);
  bindBack(showStartMenu);
  const inp = $('#code');
  inp.oninput = () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); };
  $('#go').onclick = async () => {
    if (!/^\d{6}$/.test(inp.value)) return toast('6桁の数字を入れてください');
    try {
      const room = await O.watchRoom(inp.value);
      enterWatch(room);
    } catch (e) {
      toast(e.message);
    }
  };
}

async function doJoin(code) {
  try {
    const room = await O.joinRoom(code);
    enterRoom(room);
  } catch (e) {
    toast(e.message);
    showMenu();
  }
}

// ---------------------------------------------------------------- 対局の管理
// G に今の対局をまとめて持つ
let G = null;

// 部屋を作った人(配る・次の月へ進める役)。観戦者は何もしない。
const isHost = () => !!G && G.mode === 'online' && !G.spectator && G.me === 0;

function newMatch(opts) {
  if (G && G.unsub) G.unsub();
  if (G && G.cpuTimer) clearTimeout(G.cpuTimer);
  G = {
    mode: 'cpu', me: 0, state: null, room: null,
    sel: null, choose: null, busy: false, queue: Promise.resolve(), saved: false,
    ...opts,
  };
  return G;
}

// 状態の更新は順番に処理する(アニメーションが重ならないように)
function enqueue(fn) {
  const g = G;
  g.queue = g.queue.then(() => (G === g ? fn() : null)).catch((e) => { console.error(e); toast(e.message || String(e)); });
  return g.queue;
}

// 自分の操作。CPU対戦はその場で計算し、オンラインはサーバーに操作を送って判定してもらう。
//   fn     … CPU対戦で使う(盤面 → 次の盤面)
//   online … オンラインでサーバーに送る操作 { type, args }
async function act(fn, online) {
  if (!G || G.busy || G.spectator) return;
  if (G.mode === 'online') {
    const g = G;
    g.busy = true;
    // 相手の動きを画面に反映し終えてから送る
    await g.queue;
    if (G !== g) return;
    let res;
    try {
      res = await O.gameAction(g.room.id, online.type, online.args || {});
    } catch (e) {
      g.busy = false;
      toast(e.message);
      if (G !== g) return;
      // 閉じた画面(こいこいの選択など)を出し直し、サーバーの盤面も取り直す
      if (G.state && $('.game', screenEl)) {
        renderGame(G.state);
        if (!G.lock) showPhaseModal(G.state, { sound: false });
      }
      refreshView();
      return;
    }
    g.busy = false;
    if (G !== g) return;
    G.sel = null;
    G.choose = null;
    if (res.version > g.room.version) g.room = { ...g.room, version: res.version };
    receiveView(res.view);
    return;
  }
  let next;
  try { next = fn(G.state); } catch (e) { toast(e.message); return; }
  G.sel = null;
  G.choose = null;
  enqueue(() => applyState(next));
}

// サーバーから届いた自分の盤面を反映する(自分の操作の返事と、相手の操作の知らせの両方)
function receiveView(st) {
  if (!G || !st) return;
  const g = G;
  enqueue(async () => {
    if (G !== g) return;
    if (G.state && st.seq <= G.state.seq) return; // もう反映した盤面
    if (st.phase === 'dice' && G.state && G.state.phase === 'gameEnd') {
      await startRematch(st);
      return;
    }
    if (st.phase === 'dice' && (!G.state || G.state.phase === 'dice')) {
      G.state = st;
      await runDice(st);
      if (isHost()) hostDeal();
      return;
    }
    await applyState(st);
  });
}

// 通信が途切れたときなどに、サーバーの盤面を取り直す
async function refreshView() {
  const g = G;
  if (!g || g.mode !== 'online' || g.spectator || !g.room) return;
  try {
    const st = await O.getMyView(g.room.id, app.user.id);
    if (G === g && st) receiveView(st);
  } catch (e) { /* 次の知らせを待つ */ }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshView();
});

// ---------------------------------------------------------------- CPU対戦
function startCpuGame(settings) {
  const dice = E.rollDice();
  const names = [myName(), 'CPU'];
  const cpuIcon = ['ino', 'shika', 'cho', 'tsuru'].filter((i) => i !== myIcon())[Math.floor(Math.random() * 3)];
  const state = E.newGame(settings, dice, names, [myIcon(), cpuIcon]);
  newMatch({ mode: 'cpu', me: 0, state });
  runDice(state).then(() => enqueue(() => applyState(E.startRound(G.state))));
}

function scheduleCpu() {
  const s = G.state;
  if (G.mode !== 'cpu' || s.turn !== 1 || G.lock) return;
  if (!['play', 'draw', 'chooseDraw', 'koikoi'].includes(s.phase)) return;
  clearTimeout(G.cpuTimer);
  const g = G;
  G.cpuTimer = setTimeout(() => {
    if (G !== g) return;
    enqueue(() => {
      const st = G.state;
      if (st.turn !== 1) return null;
      let next;
      if (st.phase === 'play') {
        const m = CPU.choosePlay(st, 1);
        next = E.playCard(st, 1, m.card, m.target);
      } else if (st.phase === 'draw') {
        next = E.drawCard(st, 1);
      } else if (st.phase === 'chooseDraw') {
        next = E.chooseDraw(st, 1, CPU.chooseDrawTarget(st, 1));
      } else if (st.phase === 'koikoi') {
        next = E.decide(st, 1, CPU.chooseKoikoi(st, 1));
      } else return null;
      return applyState(next);
    });
  }, s.phase === 'koikoi' ? 900 : s.phase === 'draw' ? 550 : 750);
}

// ---------------------------------------------------------------- オンライン対戦
async function enterRoom(room) {
  const me = room.host_id === app.user.id ? 0 : 1;
  newMatch({ mode: 'online', me, room, state: null });
  G.unsub = O.subscribeRoom(room.id, (row) => onRoomRow(row), (st) => receiveView(st));
  if (!room.state) {
    watchStart(G);
    if (me === 0) {
      if (room.guest_id) return hostStart(room);
      return showWaiting(room);
    }
    return showGuestWaiting(room);
  }
  // 入り直し: サーバーから自分の盤面をもらって、そのまま表示
  const g = G;
  let st = null;
  try { st = await O.getMyView(room.id, app.user.id); } catch (e) { /* 下で扱う */ }
  if (G !== g) return;
  if (!st) {
    toast('盤面を読み込めませんでした');
    return showMenu();
  }
  G.state = st;
  if (st.phase === 'dice') {
    // サイコロを見せ終わるまで、届いた盤面は順番待ちにする
    enqueue(async () => {
      await runDice(st);
      if (isHost()) hostDeal();
    });
    return;
  }
  renderGame(G.state);
  afterState(G.state, true);
}

function onRoomRow(row) {
  if (!G || G.mode !== 'online' || row.id !== G.room.id) return;
  if (row.version < G.room.version) return; // 遅れて届いた古い知らせ
  G.room = row;
  if (!row.state) {
    // ゲストが入ってきた
    if (isHost() && row.guest_id) hostStart(row);
    return;
  }
  // 観戦者は部屋の(伏せた)盤面を見る。プレイヤーは自分の盤面が別に届く
  if (G.spectator) receiveView(row.state);
}

// リアルタイムの知らせを取りこぼしても止まらないように、始まるまでは数秒ごとに確かめる
async function watchStart(g) {
  for (let i = 0; i < 200; i += 1) {
    await sleep(3000);
    if (G !== g || g.state) return;
    try {
      if (g.me === 0 && !g.room.guest_id) {
        const row = await O.getRoom(g.room.id);
        if (G !== g || g.state) return;
        if (row.status === 'closed') return;
        if (row.guest_id) { g.room = row; hostStart(row); }
      } else {
        await refreshView();
      }
    } catch (e) { /* 次に確かめる */ }
  }
}

// 観戦: 部屋を作った人の側から見る。書き込みはしない。
async function enterWatch(room) {
  newMatch({ mode: 'online', spectator: true, me: 0, room, state: null });
  G.unsub = O.subscribeRoom(room.id, (row) => onRoomRow(row));
  if (!room.state) {
    show(`
      <section class="page">
        ${pageHead('観戦')}
        <div class="panel" style="text-align:center"><h3>部屋コード</h3><div class="big-code">${room.code}</div></div>
        <p style="text-align:center" class="waiting-dots">対局が始まるのを待っています</p>
      </section>`);
    bindBack(leaveWatch);
    return;
  }
  G.state = room.state;
  if (room.state.phase === 'dice') {
    // サイコロを見せ終わるまで、届いた配りは順番待ちにする
    enqueue(() => runDice(room.state));
    return;
  }
  renderGame(G.state);
  afterState(G.state, true);
}

async function leaveWatch() {
  const g = G;
  if (!g || !g.spectator) return;
  if (g.unsub) g.unsub();
  O.leaveWatch(g.room.id).catch(() => {});
  if (G === g) G = null;
  closeOverlay();
  showMenu();
}

// 観戦中に上下を入れ替える
function swapView() {
  if (!G || !G.spectator || !G.state) return;
  G.me = 1 - G.me;
  closeOverlay();
  renderGame(G.state);
  showPhaseModal(G.state, { sound: false });
}

// ゲストが入ったら、サーバーに対局を始めてもらう(名前やサイコロはサーバーが決める)
async function hostStart(room) {
  if (G.starting) return;
  G.starting = true;
  const g = G;
  let res;
  try {
    res = await O.gameAction(room.id, 'start');
  } catch (e) {
    if (G !== g) return;
    G.starting = false;
    if (!/もう始まって/.test(e.message)) toast(e.message);
    // もう始まっていたら、その盤面を取りに行く
    refreshView();
    return;
  }
  if (G !== g) return;
  if (res.version > g.room.version) g.room = { ...g.room, version: res.version };
  receiveView(res.view);
}

async function hostDeal() {
  if (!isHost()) return;
  const st = G.state;
  if (st.phase !== 'dice') return;
  await act(null, { type: 'deal' });
}

function inviteUrl(code) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

function showWaiting(room) {
  const url = inviteUrl(room.code);
  show(`
    <section class="page">
      ${pageHead('相手を待っています')}
      <div class="panel stack" style="text-align:center">
        <h3>部屋コード</h3>
        <div class="big-code">${room.code}</div>
        <div class="choices two">
          <button id="copy">招待リンクをコピー</button>
          <button id="share">LINEなどで送る</button>
        </div>
      </div>
      <p style="text-align:center" class="waiting-dots">相手を待っています</p>
      <div class="versus"><div class="who">${iconHTML(myIcon(), 64)}<b>${esc(myName())}</b></div><div class="vs">対</div><div class="who"><div class="icon" style="--s:64px">？</div><b>…</b></div></div>
    </section>`);
  bindBack(async () => { await O.closeRoom(room); newMatch({}); G = null; showMenu(); });
  $('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast('招待リンクをコピーしました'); } catch (e) { toast(url); }
  };
  $('#share').onclick = async () => {
    const text = `喫煙所花札で対戦しよう。部屋コード ${room.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: '喫煙所花札', text, url }); } catch (e) { /* 閉じただけ */ }
    } else {
      location.href = `https://line.me/R/msg/text/?${encodeURIComponent(text + '\n' + url)}`;
    }
  };
}

function showGuestWaiting(room) {
  show(`
    <section class="page">
      ${pageHead('部屋に入りました')}
      <div class="panel" style="text-align:center"><h3>部屋コード</h3><div class="big-code">${room.code}</div></div>
      <p style="text-align:center" class="waiting-dots">始まるのを待っています</p>
    </section>`);
  bindBack(() => { newMatch({}); G = null; showMenu(); });
}

// ---------------------------------------------------------------- サイコロ
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function dieHTML(n, rolling) {
  const cls = n === 1 ? 'one' : n === 4 ? 'four' : '';
  return `<div class="die ${cls} ${rolling ? 'rolling' : ''}">${Array.from({ length: 9 }, (_, i) => `<i class="${PIPS[n].includes(i) ? 'on' : ''}"></i>`).join('')}</div>`;
}

async function runDice(state) {
  const names = state.names;
  const icons = state.icons || ['tsuru', 'ino'];
  if (state.carried) {
    // 年をまたいだ再戦: サイコロは振らずに、前の年の親を引き継ぐ
    const st = state.oyaStreak || 1;
    show(`
      <section class="dice-wrap">
        <div class="versus">
          <div class="who">${iconHTML(icons[0], 60)}<b>${esc(names[0])}</b></div>
          <div class="vs">対</div>
          <div class="who">${iconHTML(icons[1], 60)}<b>${esc(names[1])}</b></div>
        </div>
        <div class="dice-result">
          <p class="muted">${state.year}年目 ・ 親は前の年から引き継ぎ</p>
          <h2>${esc(names[state.oya])}さんが親です</h2>
          ${st >= 2 ? `<p class="streak">親 ${st}連チャン</p>` : ''}
        </div>
      </section>`);
    S.pachi(1.2);
    await sleep(2400);
    return;
  }
  show(`
    <section class="dice-wrap">
      <div class="versus">
        <div class="who">${iconHTML(icons[0], 60)}<b>${esc(names[0])}</b><small class="muted">偶数で親</small></div>
        <div class="vs">対</div>
        <div class="who">${iconHTML(icons[1], 60)}<b>${esc(names[1])}</b><small class="muted">奇数で親</small></div>
      </div>
      <div id="die">${dieHTML(1, true)}</div>
      <div class="dice-result" id="dres"><p class="muted">サイコロで親を決めます</p></div>
    </section>`);
  const dieBox = $('#die');
  for (let i = 0; i < 14; i += 1) {
    dieBox.innerHTML = dieHTML(1 + Math.floor(Math.random() * 6), true);
    if (i % 2 === 0) S.pachi(0.4);
    await sleep(110);
  }
  dieBox.innerHTML = dieHTML(state.dice, false);
  S.pachi(1.2);
  const oya = E.oyaFromDice(state.dice);
  $('#dres').innerHTML = `<p class="muted">${state.dice} ・ ${state.dice % 2 === 0 ? '偶数' : '奇数'}</p><h2>${esc(names[oya])}さんが親です</h2>`;
  await sleep(2200);
}

// ---------------------------------------------------------------- 対局画面の描画
function capGroups(ids) {
  const groups = { hikari: [], tane: [], tanzaku: [], kasu: [] };
  for (const id of ids) groups[CARD[id].type].push(id);
  return Object.entries(groups).filter(([, v]) => v.length)
    .map(([, v]) => `<div class="grp">${v.map((id) => cardHTML(id)).join('')}<em>${v.length}</em></div>`).join('');
}

const guideOn = (s) => s.settings.guide !== false;
const QUIT_PHASES = ['play', 'draw', 'chooseDraw', 'koikoi', 'roundEnd'];

function guideHTML(s, p) {
  if (!guideOn(s)) return '';
  const near = nearYaku(s.captured[p], s.captured[1 - p]);
  return near.map((y) => `<span class="chip">${y.text}</span>`).join('');
}

function pbarHTML(s, p) {
  const sc = scoreCaptured(s.captured[p], s.settings).total;
  const icons = s.icons || ['tsuru', 'ino'];
  const myTurn = s.turn === p && ['play', 'draw', 'chooseDraw', 'koikoi'].includes(s.phase);
  return `<div class="pbar">
    <span class="turn-dot ${myTurn ? 'on' : ''}"></span>${iconHTML(icons[p], 34)}
    <span class="nm">${esc(s.names[p])}</span>
    ${s.oya === p ? `<span class="badge oya">親${(s.oyaStreak || 1) >= 2 ? ` ${s.oyaStreak}連` : ''}</span>` : ''}
    ${s.koi[p] ? '<span class="badge koi">こいこい</span>' : ''}
    <div class="pts"><b>${s.scores[p]}</b><small>${sc ? `今の役 ${sc}点` : '合計'}</small></div>
    ${p !== G.me && G.spectator ? '<button class="quit" data-stats>戦績</button><button class="quit" data-swap>入替</button><button class="quit" data-leave>退出</button>' : ''}
    ${p !== G.me && !G.spectator && !['gameEnd', 'aborted', 'deal', 'dice'].includes(s.phase) ? '<button class="quit" data-stats>戦績</button><button class="quit" data-quit>中断</button>' : ''}
  </div>`;
}

function bannerText(s) {
  const me = G.me;
  if (G.spectator) {
    const who = esc(s.names[s.turn]);
    if (s.quit && !s.quit.accepted) return '中断が申請されています';
    if (s.phase === 'play') return `${who}さんの番`;
    if (s.phase === 'draw') return `${who}さんが山札を引きます…`;
    if (s.phase === 'chooseDraw') return `${who}さんが取る札を選んでいます…`;
    if (s.phase === 'koikoi') return `${who}さんがこいこいか上がりか考えています…`;
    return '';
  }
  if (s.quit && !s.quit.accepted) return s.quit.by === me ? '中断の返事を待っています…' : '中断が申請されています';
  if (G.choose) return '取る札を選んでください';
  if (s.phase === 'draw') return s.turn === me ? '山札をタップして引く' : '相手が山札を引きます…';
  if (s.phase === 'chooseDraw') return s.turn === me ? 'めくった札で取る札を選んでください' : '相手が選んでいます…';
  if (s.phase === 'koikoi') return s.turn === me ? '' : '相手が考えています…';
  if (s.phase === 'play') {
    if (s.turn !== me) return '相手の番';
    return prefs.tapMode === 'single' ? 'あなたの番 ・ 札をタップで出す' : 'あなたの番 ・ もう一度タップで出す';
  }
  return '';
}

function renderGame(s) {
  const me = G.me;
  const op = 1 - me;
  const myTurnPlay = s.turn === me && s.phase === 'play';
  const watchers = G.mode === 'online' && G.room && G.room.spectators ? G.room.spectators.length : 0;
  const selMonth = G.sel ? CARD[G.sel].month : null;
  const pickIds = G.choose ? G.choose.options
    : s.phase === 'chooseDraw' && s.turn === me && s.pending ? s.pending.options : [];

  const fieldHTML = s.field.map((id) => {
    let cls = '';
    if (G.flash && G.flash.includes(id)) cls = 'flash';
    else if (pickIds.length) cls = pickIds.includes(id) ? 'pick' : 'dim';
    else if (prefs.highlight && selMonth && CARD[id].month === selMonth) cls = 'glow';
    return cardHTML(id, cls);
  }).join('');

  const hand = G.spectator ? s.hands[me].map((_, i) => `back-${i}`) : sortCards(s.hands[me]);
  const n = hand.length;
  const spread = Math.min(22, n * 3);
  const handHTML = hand.map((id, i) => {
    const a = n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0;
    const k = (i - (n - 1) / 2) * (n > 6 ? 0.4 : 0.56);
    const sel = G.sel === id || (G.choose && G.choose.card === id);
    const lift = sel ? ' translateY(-22px) scale(1.14)' : '';
    const glow = !G.spectator && prefs.highlight && myTurnPlay && s.field.some((f) => CARD[f].month === CARD[id].month) ? 'glow' : '';
    const face = G.spectator ? backHTML() : cardHTML(id, glow);
    return `<div class="slot ${sel ? 'sel' : ''}" data-rot="${sel ? 0 : a}" style="z-index:${i + 1};transform:translateX(calc(-50% + ${k} * var(--hw))) rotate(${sel ? 0 : a}deg)${lift}">${face}</div>`;
  }).join('');

  const banner = bannerText(s);
  const months = s.settings.months;
  screenEl.innerHTML = `
    <div class="game">
      ${pbarHTML(s, op)}
      <div class="opp-hand">${Array.from({ length: s.hands[op].length }, backHTML).join('')}</div>
      <div class="capt" data-capt="${op}">${capGroups(s.captured[op])}<span class="hint">拡大</span></div>
      <div class="table">
        <div class="month-tag">${(s.year || 1) > 1 ? `${s.year}年目 ・ ` : ''}${s.month}月 ${months <= 12 ? MONTH_PLANTS[s.month] : ''} ・ ${s.month}/${months}${watchers ? ` ・ 観戦${watchers}人` : ''}</div>
        <div class="deck-zone">
          <div class="deck ${s.phase === 'draw' && s.turn === me && !s.quit ? 'tap' : ''}">${s.deck.length ? backHTML() + backHTML() + backHTML() : ''}</div>
          <div class="deck-count">山 ${s.deck.length}</div>
          <div class="reveal-slot">${s.phase === 'chooseDraw' && s.pending ? cardHTML(s.pending.drawn, 'glow') : ''}</div>
        </div>
        <div class="field">${fieldHTML}</div>
        ${banner ? `<div class="banner">${banner}</div>` : ''}
      </div>
      <div class="guide-row">${guideHTML(s, me)}</div>
      <div class="capt" data-capt="${me}">${capGroups(s.captured[me])}<span class="hint">拡大</span></div>
      ${pbarHTML(s, me)}
      <div class="hand ${myTurnPlay && !G.spectator ? '' : 'wait'} ${G.spectator ? 'watch' : ''}">${handHTML}</div>
    </div>`;
}

// 札の位置の変化をなめらかに見せる(FLIP)
function flipRender(s, { fromOpp = [], fromMine = [], turnOver = [] } = {}) {
  const before = new Map();
  $$('.card[data-id]', screenEl).forEach((el) => before.set(el.dataset.id, el.getBoundingClientRect()));
  const deckEl = $('.deck', screenEl);
  const deckRect = deckEl ? deckEl.getBoundingClientRect() : null;
  const oppEl = $('.opp-hand', screenEl);
  const oppRect = oppEl ? oppEl.getBoundingClientRect() : null;
  const handEl = $('.hand', screenEl);
  const handRect = handEl ? handEl.getBoundingClientRect() : null;
  renderGame(s);
  let moved = 0;
  $$('.card[data-id]', screenEl).forEach((el) => {
    const id = el.dataset.id;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const old = before.get(id);
    let dx;
    let dy;
    let sc;
    if (old) {
      dx = old.left - r.left;
      dy = old.top - r.top;
      sc = old.width / r.width;
    } else {
      // 新しく見えた札: 山札(相手が出した札は相手の手元)から飛んでくる
      const o = fromOpp.includes(id) ? oppRect : fromMine.includes(id) ? handRect : deckRect;
      if (!o) return;
      sc = Math.min(1, Math.max(0.3, o.width / r.width));
      dx = o.left + o.width / 2 - r.left - (r.width * sc) / 2;
      dy = o.top + o.height / 2 - r.top - (r.height * sc) / 2;
    }
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sc - 1) < 0.02) return;
    // 扇の中の札は回転しているので、その分戻して動かす
    const slot = el.closest('.slot');
    if (slot) {
      const a = (-Number(slot.dataset.rot || 0) * Math.PI) / 180;
      [dx, dy] = [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
    }
    moved += 1;
    if (!old && turnOver.includes(id)) {
      // 山札から出てきながら、裏から表へ返る
      el.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotateY(180deg)`, transformOrigin: 'center', filter: 'brightness(.25)', zIndex: 50 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45}px) scale(${(sc + 1) / 2}) rotateY(90deg)`, transformOrigin: 'center', filter: 'brightness(.25)', zIndex: 50, offset: 0.45 },
        { transform: 'none', transformOrigin: 'center', filter: 'none', zIndex: 50 },
      ], { duration: 520, easing: 'cubic-bezier(.25,.7,.3,1)' });
      return;
    }
    el.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, transformOrigin: 'top left', zIndex: 50 },
      { transform: 'none', transformOrigin: 'top left', zIndex: 50 },
    ], { duration: 360, easing: 'cubic-bezier(.2,.75,.25,1)' });
  });
  return moved;
}

// 出した札(めくった札)を、取る札の隣に置いた見た目を作る。取り札に移る前に見せる。
//   base  … 出す前の状態 / after … 取った後の状態
function stageView(base, after, p, card, took) {
  if (!base || !took.length || !took.every((t) => base.field.includes(t))) return null;
  const v = JSON.parse(JSON.stringify(after));
  v.captured[p] = after.captured[p].filter((id) => id !== card && !took.includes(id));
  const field = base.field.filter((id) => id !== card);
  const at = Math.max(...took.map((t) => field.indexOf(t)));
  field.splice(at + 1, 0, card);
  v.field = field;
  v.phase = 'stage';
  v.pending = null;
  return v;
}

// 相手の札は1秒止める。自分の札は軽く見せるだけ。
async function showTake(base, after, ev, fromOpp, turnOver = [], fromMine = []) {
  const st = stageView(base, after, ev.p, ev.card, ev.took);
  if (!st) return false;
  G.flash = [ev.card, ...ev.took];
  flipRender(st, { fromOpp, fromMine, turnOver });
  if (turnOver.length) await sleep(380);
  S.pachi(0.9);
  await sleep(ev.p !== G.me || G.spectator ? 1000 : 400);
  G.flash = null;
  return true;
}

// 山札からめくる前の見た目(出した直後)を作る
function undoDraw(s, ev) {
  const v = JSON.parse(JSON.stringify(s));
  const p = ev.p;
  v.captured[p] = v.captured[p].filter((id) => id !== ev.card && !ev.took.includes(id));
  v.field = v.field.filter((id) => id !== ev.card);
  v.field.push(...ev.took);
  v.deck = [ev.card, ...v.deck];
  v.phase = 'play';
  v.pending = null;
  return v;
}

async function runDeal(s, ev) {
  const v = JSON.parse(JSON.stringify(s));
  v.hands = [[], []];
  v.field = [];
  v.captured = [[], []];
  v.phase = 'deal';
  v.deck = [...s.deck, ...ev.order.flatMap((o) => o.ids)];
  renderGame(v);
  if (ev.redeals) { toast('場に同じ月が4枚出たので配り直しました'); }
  await sleep(300);
  for (const o of ev.order) {
    v.deck = v.deck.slice(2);
    if (o.to === 'field') v.field.push(...o.ids);
    else v.hands[Number(o.to[1])].push(...o.ids);
    flipRender(v);
    S.pachi(0.6);
    await sleep(170);
  }
  await sleep(250);
}

function shout(text, sub = '') {
  const el = document.createElement('div');
  el.className = 'shout';
  el.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
  $('#app').appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

// 新しい状態を、出来事に合わせてアニメーションしながら反映する
async function applyState(next) {
  if (!next) return;
  const prev = G.state;
  G.state = next;
  G.sel = null;
  G.choose = null;
  const evs = next.events || [];
  const me = G.me;

  const deal = evs.find((e) => e.type === 'deal');
  const play = evs.find((e) => e.type === 'play');
  const draw = evs.find((e) => e.type === 'draw');
  const reveal = evs.find((e) => e.type === 'reveal');

  if (deal) {
    closeOverlay();
    await runDeal(next, deal);
  } else if (!$('.game', screenEl)) {
    renderGame(prev && prev.deck && prev.deck.length && prev.phase !== 'dice' ? prev : next);
  }

  if (play) {
    // まず手札を出したところまで見せる
    let mid = next;
    if (draw) mid = undoDraw(next, draw);
    else if (reveal) mid = { ...next, phase: 'play', pending: null, deck: [reveal.card, ...next.deck] };
    const fromOpp = play.p !== me ? [play.card] : [];
    const fromMine = G.spectator && play.p === me ? [play.card] : [];
    const staged = await showTake(prev, mid, play, fromOpp, [], fromMine);
    flipRender(mid, staged ? {} : { fromOpp, fromMine });
    S.pachi(play.took.length ? 1.1 : 0.8);
    await sleep(draw || reveal ? (play.p !== me || G.spectator ? 700 : 520) : 360);
  }
  // 山札からめくった札
  const drawn = draw ? [draw.card] : reveal ? [reveal.card] : [];
  let shown = false;
  if (draw) {
    const base = play ? undoDraw(next, draw) : prev;
    shown = await showTake(base, next, draw, [], drawn);
  }
  flipRender(next, { turnOver: shown ? [] : drawn });
  if (draw || reveal) {
    S.pachi(draw && draw.took.length ? 1.1 : 0.7);
    await sleep(draw && (draw.p !== me || G.spectator) ? 600 : 420);
  }
  const qe = evs.find((e) => e.type === 'quitDeclined');
  if (qe && qe.p !== me) toast('中断は断られました。続けます');
  if (evs.some((e) => e.type === 'quitRequest' && e.p === me)) toast('中断を申請しました');

  const hy = evs.find((e) => e.type === 'handYaku');
  if (hy) {
    S.fanfare();
    shout(hy.yaku.name, `${esc(next.names[hy.p])} ${hy.yaku.points}点`);
    await sleep(1500);
  }
  const yk = evs.find((e) => e.type === 'yaku');
  if (yk && (yk.p !== me || G.spectator)) {
    S.fanfare();
    shout(yk.yaku.map((y) => y.name).join('・'), `${esc(next.names[yk.p])} ${yk.total}点`);
    await sleep(1400);
  } else if (yk && yk.p === me && next.phase !== 'koikoi') {
    S.fanfare();
    shout(yk.yaku.map((y) => y.name).join('・'), `${yk.total}点`);
    await sleep(1300);
  }
  const koi = evs.find((e) => e.type === 'koikoi');
  if (koi) {
    S.koikoiSound();
    shout('こいこい', esc(next.names[koi.p]));
    await sleep(1400);
  }
  afterState(next, false);
}

// いまの状態に合った画面(こいこい・リザルトなど)を重ねる
function showPhaseModal(s, opts = {}) {
  const me = G.me;
  // 場を見ている途中なら、月の結果のあいだはそのまま見せておく
  const asked = s.quit && !s.quit.accepted && s.quit.by !== me && !G.spectator;
  if (overlayEl.classList.contains('peek') && ['roundEnd', 'gameEnd', 'koikoi'].includes(s.phase) && !asked) return;
  if (s.phase === 'aborted') showAborted(s);
  else if (G.spectator && ['play', 'draw', 'chooseDraw', 'koikoi'].includes(s.phase)) closeOverlay();
  else if (asked) showQuitAsk(s);
  else if (s.phase === 'koikoi' && s.turn === me) showKoikoiModal(s, opts);
  else if (s.phase === 'roundEnd') showRoundResult(s);
  else if (s.phase === 'gameEnd') showFinal(s);
  else closeOverlay();
}

function afterState(s) {
  if (!G.lock) showPhaseModal(s);
  if (G.mode === 'cpu') scheduleCpu();
  // オンラインでは、次の月を配る・戦績を残す・再戦を始めるのはサーバーがやる
}

async function startRematch(ns) {
  G.state = ns;
  G.saved = false;
  G.sel = null;
  G.choose = null;
  closeOverlay();
  await runDice(ns);
  if (isHost()) hostDeal();
}

// ---------------------------------------------------------------- 対局中のタップ
screenEl.addEventListener('click', (e) => {
  if (!G || !G.state || !$('.game', screenEl)) return;
  const s = G.state;
  const me = G.me;

  if (e.target.closest('[data-quit]')) return onQuit();
  if (e.target.closest('[data-stats]')) return showStats();
  if (e.target.closest('[data-swap]')) return swapView();
  if (e.target.closest('[data-leave]')) return leaveWatch();

  const capt = e.target.closest('.capt');
  if (capt) return showCaptured(Number(capt.dataset.capt), overlayEl.classList.contains('peek') ? peekBoard : null);
  if (G.spectator) return;

  if (s.phase === 'draw' && s.turn === me && e.target.closest('.deck-zone, .banner')) {
    S.pachi(0.4);
    return act((st) => E.drawCard(st, me), { type: 'draw' });
  }

  const handCard = e.target.closest('.hand .card');
  if (handCard) {
    const id = handCard.dataset.id;
    if (s.turn !== me || s.phase !== 'play' || G.busy) {
      G.sel = G.sel === id ? null : id;
      renderGame(s);
      return;
    }
    if (G.choose) G.choose = null;
    if (prefs.tapMode === 'single' || G.sel === id) return playFromHand(id);
    G.sel = id;
    S.pachi(0.25);
    renderGame(s);
    return;
  }

  const fieldCard = e.target.closest('.field .card.pick');
  if (fieldCard) {
    const target = fieldCard.dataset.id;
    if (G.choose && s.phase === 'play' && s.turn === me) {
      const { card } = G.choose;
      return act((st) => E.playCard(st, me, card, target), { type: 'play', args: { card, target } });
    }
    if (s.phase === 'chooseDraw' && s.turn === me) return act((st) => E.chooseDraw(st, me, target), { type: 'choose', args: { target } });
  }

  // 何もないところを押したら選択を解除
  if (G.sel || G.choose) {
    G.sel = null;
    G.choose = null;
    renderGame(s);
  }
});

function playFromHand(id) {
  if (G.state.phase !== 'play' || G.state.turn !== G.me) return;
  const opts = E.fieldOptions(G.state, id);
  if (opts.length === 2) {
    G.choose = { card: id, options: opts };
    G.sel = id;
    renderGame(G.state);
    return;
  }
  act((st) => E.playCard(st, G.me, id, null), { type: 'play', args: { card: id, target: null } });
}

// ---------------------------------------------------------------- 対局中の戦績
// この対局の月ごとの結果と、(友達との対戦なら)この相手との通算を見せる
function showStats() {
  if (!G || !G.state) return;
  const s = G.state;
  const me = G.me;
  G.lock = true;
  clearTimeout(G.cpuTimer);
  const rows = s.history.filter((h) => !h.aborted).map((h) => {
    const who = h.winner === null ? '引き分け' : esc(s.names[h.winner]);
    const pts = h.winner === null ? '-' : `<span class="${h.winner === me ? 'plus' : 'minus'}">${h.winner === me ? '+' : '−'}${h.points}</span>`;
    return `<tr><td>${h.month}月</td><td>${who}</td><td class="yk">${(h.yaku || []).join('・') || '-'}</td><td>${pts}</td></tr>`;
  }).join('');
  openOverlay(`<div class="modal stats">
    <h2>戦績</h2>
    <p class="stats-sub">${(s.year || 1) > 1 ? `${s.year}年目 ・ ` : ''}${s.settings.months}ヶ月戦の${s.month}月目</p>
    <table class="score-table"><tr><th></th><th>${esc(s.names[me])}</th><th>${esc(s.names[1 - me])}</th></tr>
      <tr><td>いまの合計</td><td><b style="font-size:20px">${s.scores[me]}</b></td><td><b style="font-size:20px">${s.scores[1 - me]}</b></td></tr></table>
    ${diffText(s)}
    ${rows ? `<table class="month-table"><tr><th>月</th><th>上がり</th><th>役</th><th>点</th></tr>${rows}</table>
      <div class="flow">${flowHTML(s.history, me, s.names)}</div>` : '<p style="text-align:center;color:var(--ink-soft)">まだ終わった月はありません</p>'}
    <div id="vs-record">${G.spectator ? '' : G.mode === 'online' ? '<p class="stats-sub">この相手との通算を読み込み中…</p>' : '<p class="stats-sub">CPU対戦は戦績に残りません</p>'}</div>
    <button class="btn" style="margin-top:14px" id="cls">閉じる</button>
  </div>`, { dismiss: false });
  const g = G;
  const close = () => {
    if (G !== g) return;
    G.lock = false;
    showPhaseModal(G.state, { sound: false });
    scheduleCpu();
  };
  $('#cls').onclick = close;
  $('.ov-bg', overlayEl).onclick = close;
  if (G.mode === 'online' && !G.spectator) loadVsRecord(g);
}

async function loadVsRecord(g) {
  const uid = app.user.id;
  const oid = g.me === 0 ? g.room.guest_id : g.room.host_id;
  let w = 0; let l = 0; let d = 0; let diff = 0;
  const vs = [];
  try {
    const ms = await O.listMatches();
    for (const m of ms) {
      const me = m.player0 === uid ? 0 : 1;
      if ((me === 0 ? m.player1 : m.player0) !== oid) continue;
      vs.push(m);
      const x = m.scores[me] - m.scores[1 - me];
      diff += x;
      if (x > 0) w += 1; else if (x < 0) l += 1; else d += 1;
    }
  } catch (e) {
    const box = $('#vs-record');
    if (box) box.innerHTML = '<p class="stats-sub">通算を読み込めませんでした</p>';
    return;
  }
  const box = $('#vs-record');
  if (!box || G !== g) return;
  const n = w + l + d;
  box.innerHTML = `<div class="vs-record"><h3>${esc(g.state.names[1 - g.me])}さんとの通算(この対局より前)</h3>
    ${n ? `<p>${n}戦 ${w}勝 ${l}敗${d ? ` ${d}分` : ''} ・ <span class="${diff >= 0 ? 'plus' : 'minus'}">${diff > 0 ? '+' : ''}${diff}点</span></p>
      <p>月ごと ${wlText(monthStatsOf(vs, uid))}</p>` : '<p>まだ終わった対局はありません</p>'}</div>`;
}

// ---------------------------------------------------------------- 中断
// 確認の画面を出しているあいだは、ほかの画面で上書きしない
function confirmBox(title, body, okLabel, onOk) {
  G.lock = true;
  clearTimeout(G.cpuTimer);
  openOverlay(`<div class="modal">
    <h2>${title}</h2>
    <p style="text-align:center;margin:0 0 6px;line-height:1.6">${body}</p>
    <div class="choose-row">
      <button class="btn ghost" style="color:var(--ink);box-shadow:inset 0 0 0 2px var(--ink);font-size:17px" id="no">続ける</button>
      <button class="btn shu" style="font-size:17px" id="yes">${okLabel}</button>
    </div>
  </div>`, { dismiss: false });
  const g = G;
  const release = () => { if (G === g) { G.lock = false; } };
  $('#no').onclick = () => {
    release();
    if (G !== g) return;
    showPhaseModal(G.state, { sound: false });
    scheduleCpu();
  };
  $('#yes').onclick = () => { release(); onOk(); };
}

function onQuit() {
  if (!G || !G.state) return;
  const s = G.state;
  if (!QUIT_PHASES.includes(s.phase)) return;
  if (G.mode === 'cpu') {
    confirmBox('中断しますか？', 'CPU対戦を終わってメニューに戻ります。', '中断する', () => {
      clearTimeout(G.cpuTimer);
      G = null;
      closeOverlay();
      showMenu();
    });
    return;
  }
  if (s.quit) { toast(s.quit.by === G.me ? '相手の返事を待っています' : '相手から中断の申請が来ています'); return; }
  const done = s.history.length;
  confirmBox('中断を申請しますか？',
    `相手が了承すると中断します。<br>${done ? `終わった${done}ヶ月分は戦績に残り、` : ''}途中の月は残りません。`,
    '申請する', () => {
      showPhaseModal(G.state, { sound: false });
      act((st) => E.requestQuit(st, G.me), { type: 'quit' });
    });
}

function showQuitAsk(s) {
  const me = G.me;
  const done = s.history.length;
  openOverlay(`<div class="modal">
    <h2>中断の申請</h2>
    <p style="text-align:center;margin:0 0 6px;line-height:1.6">${esc(s.names[1 - me])}さんから中断が申請されています。了承しますか？<br><small style="color:var(--ink-soft)">${done ? `終わった${done}ヶ月分は戦績に残り、` : '終わった月がないので戦績には残らず、'}途中の月は残りません。</small></p>
    <div class="choose-row">
      <button class="btn ghost" style="color:var(--ink);box-shadow:inset 0 0 0 2px var(--ink);font-size:17px" id="no">断って続ける</button>
      <button class="btn shu" style="font-size:17px" id="yes">了承する</button>
    </div>
  </div>`, { dismiss: false });
  $('#no').onclick = () => act((st) => E.answerQuit(st, me, false), { type: 'answerQuit', args: { accept: false } });
  $('#yes').onclick = () => act((st) => E.answerQuit(st, me, true), { type: 'answerQuit', args: { accept: true } });
}

function showAborted(s) {
  const me = G.me;
  const done = s.history.length;
  openOverlay(`<div class="modal">
    <h2>中断しました</h2>
    <p style="text-align:center;margin:0 0 8px;color:var(--ink-soft)">${G.spectator ? `${done}ヶ月目までで終わりました` : done ? `${done}ヶ月目までの結果を戦績に残しました` : '終わった月がないので、戦績には残りません'}</p>
    <table class="score-table"><tr><th></th><th>${esc(s.names[me])}</th><th>${esc(s.names[1 - me])}</th></tr>
      <tr><td>合計</td><td><b style="font-size:22px">${s.scores[me]}</b></td><td><b style="font-size:22px">${s.scores[1 - me]}</b></td></tr></table>
    ${diffText(s)}
    ${done ? `<div class="flow">${flowHTML(s.history, me, s.names)}</div>` : ''}
    <button class="btn shu" style="margin-top:14px" id="home">メニューへ</button>
  </div>`, { dismiss: false });
  $('#home').onclick = () => {
    if (G.spectator) return leaveWatch();
    if (G.unsub) G.unsub();
    G = null;
    closeOverlay();
    showMenu();
  };
}

// ---------------------------------------------------------------- 重ねて出す画面
function showCaptured(p, back = null) {
  const s = G.state;
  const groups = { hikari: [], tane: [], tanzaku: [], kasu: [] };
  for (const id of s.captured[p]) groups[CARD[id].type].push(id);
  const sc = scoreCaptured(s.captured[p], s.settings);
  const near = guideOn(s) ? nearYaku(s.captured[p], s.captured[1 - p]) : [];
  openOverlay(`<div class="modal capt-big">
    <h2>${esc(s.names[p])}の取り札</h2>
    ${sc.yaku.length ? `<ul class="yaku-list">${sc.yaku.map((y) => `<li>${y.name}<b>${y.points}点</b></li>`).join('')}</ul>` : '<p style="text-align:center;margin:0">まだ役はありません</p>'}
    ${near.length ? `<div class="guide-chips inline">${near.map((y) => `<span class="chip">${y.text}</span>`).join('')}</div>` : ''}
    ${Object.entries(groups).map(([k, v]) => `<h3>${TYPE_LABEL[k]}<span>${v.length}枚</span></h3><div class="cards">${v.map((id) => cardHTML(id)).join('') || '<span class="muted" style="color:var(--ink-soft)">なし</span>'}</div>`).join('')}
    <button class="btn" style="margin-top:16px" id="cls">${back ? '戻る' : '閉じる'}</button>
  </div>`, { dismiss: !back });
  $('#cls').onclick = back || closeOverlay;
  if (back) $('.ov-bg', overlayEl).onclick = back;
}

function showKoikoiModal(s, { sound = true } = {}) {
  const me = G.me;
  const { total, yaku } = s.pending;
  const now = finalPoints(total, s.koi[me], s.koi[1 - me], s.firstKoi === me);
  if (sound) S.fanfare();
  openOverlay(`<div class="modal">
    <h2>役ができました</h2>
    <ul class="yaku-list">${yaku.map((y) => `<li>${y.name}<b>${y.points}点</b></li>`).join('')}</ul>
    <div class="total-line"><span>いま上がると${now.notes.length ? `(${now.notes.join('・')})` : ''}</span><big>${now.points}点</big></div>
    ${s.koi[1 - me] ? '<p style="margin:4px 0;font-size:13px;color:var(--shu-dark)">相手がこいこい中です。上がると倍になります。</p>' : ''}
    ${fieldMiniHTML(s, 'いまの場')}
    ${lookRowHTML()}
    <div class="choose-row">
      <button class="btn ghost" style="color:var(--ink);box-shadow:inset 0 0 0 2px var(--ink)" id="koi">こいこい</button>
      <button class="btn shu" id="agari">上がり</button>
    </div>
  </div>`, { dismiss: false });
  bindLookRow(() => showKoikoiModal(G.state, { sound: false }));
  $('#koi').onclick = () => { closeOverlay(); act((st) => E.decide(st, me, 'koikoi'), { type: 'decide', args: { choice: 'koikoi' } }); };
  $('#agari').onclick = () => { closeOverlay(); act((st) => E.decide(st, me, 'agari'), { type: 'decide', args: { choice: 'agari' } }); };
}

// リザルトを一度どけて、終わった時点の場をそのまま見せる
function peekBoard() {
  const s = G.state;
  const koi = s.phase === 'koikoi' && s.turn === G.me;
  if (!koi && !['roundEnd', 'gameEnd'].includes(s.phase)) return;
  renderGame(s);
  overlayEl.classList.add('peek');
  overlayEl.innerHTML = `<div class="peek-bar"><span>${koi ? 'いまの盤面' : `${s.month}月の終わりの場`}</span><button class="btn shu small" id="peek-back">${koi ? '選ぶ画面に戻る' : '結果に戻る'}</button></div>`;
  $('#peek-back').onclick = () => {
    if (!G || !G.state) return;
    overlayEl.classList.remove('peek');
    showPhaseModal(G.state, { sound: false });
  };
}

// 結果画面の中に、終わった時点の場をそのまま並べる
function fieldMiniHTML(s, title = `${s.month}月の終わりの場`) {
  return `<div class="field-mini">
    <h3>${title}<span>${s.field.length}枚</span></h3>
    <div class="cards">${s.field.length ? s.field.map((id) => cardHTML(id)).join('') : '<span class="muted" style="color:var(--ink-soft)">場に札はありません</span>'}</div>
  </div>`;
}

function lookRowHTML() {
  const s = G.state;
  const a = G.spectator ? `${esc(s.names[G.me])}の取り札` : '自分の取り札';
  const b = G.spectator ? `${esc(s.names[1 - G.me])}の取り札` : '相手の取り札';
  return `<div class="look-row three">
      <button id="look-field">盤面を見る</button>
      <button id="look-me">${a}</button>
      <button id="look-op">${b}</button>
    </div>`;
}

function bindLookRow(back) {
  const me = G.me;
  $('#look-field').onclick = peekBoard;
  $('#look-me').onclick = () => showCaptured(me, back);
  $('#look-op').onclick = () => showCaptured(1 - me, back);
}

function diffText(s) {
  const me = G.me;
  const d = s.scores[me] - s.scores[1 - me];
  if (d === 0) return '<p class="diff">同点</p>';
  if (G.spectator) return `<p class="diff">${esc(s.names[d > 0 ? me : 1 - me])}が +${Math.abs(d)}点</p>`;
  return d > 0 ? `<p class="diff plus">あなたが +${d}点</p>` : `<p class="diff minus">${esc(s.names[1 - me])}が +${-d}点</p>`;
}

function showRoundResult(s) {
  const r = s.result;
  const me = G.me;
  const last = s.month >= s.settings.months;
  let head;
  if (r.winner === null) head = '引き分け';
  else if (r.reason === 'teshi' || r.reason === 'kuttsuki') head = `${esc(s.names[r.winner])}の${r.yaku[0].name}`;
  else head = `${esc(s.names[r.winner])}の上がり`;
  const waiting = G.mode === 'online' && (G.spectator || s.ready[me] || (s.quit && s.quit.by === me));
  openOverlay(`<div class="modal">
    <p style="text-align:center;margin:0 0 4px;color:var(--ink-soft)">${s.month}月 ${s.settings.months <= 12 ? MONTH_PLANTS[s.month] : ''} の結果</p>
    <h2>${head}</h2>
    ${r.yaku.length ? `<ul class="yaku-list">${r.yaku.map((y) => `<li>${y.name}<b>${y.points}点</b></li>`).join('')}</ul>` : '<p style="text-align:center">点数は入りません。親はそのまま続けます。</p>'}
    ${r.winner !== null ? `<div class="total-line"><span>${r.notes.length ? r.notes.join('・') : '得点'}</span><big>${r.winner === me ? '+' : ''}${r.winner === me ? r.points : r.points}点</big></div>` : ''}
    <table class="score-table" style="margin-top:8px"><tr><th></th><th>${esc(s.names[me])}</th><th>${esc(s.names[1 - me])}</th></tr>
      <tr><td>合計</td><td><b>${s.scores[me]}</b></td><td><b>${s.scores[1 - me]}</b></td></tr></table>
    ${diffText(s)}
    ${fieldMiniHTML(s)}
    ${lookRowHTML()}
    <button class="btn shu" style="margin-top:14px" id="next" ${waiting ? 'disabled' : ''}>${G.spectator ? '二人が進めるのを待っています…' : waiting ? '相手を待っています…' : last ? '最終結果へ' : '次の月へ'}</button>
    ${last || G.spectator ? (G.spectator ? '<button class="text-btn" id="leave2">観戦をやめる</button>' : '') : '<button class="text-btn" id="quit2">ここで中断する</button>'}
  </div>`, { dismiss: false });
  const q2 = $('#quit2');
  if (q2) q2.onclick = onQuit;
  const l2 = $('#leave2');
  if (l2) l2.onclick = leaveWatch;
  bindLookRow(() => showRoundResult(G.state));
  $('#next').onclick = () => {
    if (G.mode === 'cpu') { closeOverlay(); enqueue(() => applyState(E.nextRound(G.state))); return; }
    act((st) => E.setReady(st, me), { type: 'ready' });
  };
}

function flowHTML(allHistory, me, names) {
  const history = allHistory.filter((h) => !h.aborted);
  const max = Math.max(1, ...history.map((h) => h.points));
  let cum = 0;
  return history.map((h) => {
    const mine = h.winner === me;
    const signed = h.winner === null ? 0 : mine ? h.points : -h.points;
    cum += signed;
    const w = (h.points / max) * 50;
    const bar = h.winner === null ? '' : `<i style="${mine ? `left:50%;width:${w}%;background:var(--shu)` : `right:50%;width:${w}%;background:#3a6ea5`}"></i>`;
    return `<div class="flow-row"><span>${h.month}月</span><div class="flow-bar">${bar}</div><span style="text-align:right" class="${cum >= 0 ? 'plus' : 'minus'}">${cum > 0 ? '+' : ''}${cum}</span></div>`;
  }).join('') + `<div class="flow-row muted" style="color:var(--ink-soft)"><span></span><div style="display:flex;justify-content:space-between"><span>← ${esc(names[1 - me])}</span><span>${esc(names[me])} →</span></div><span>累計</span></div>`;
}

function showFinal(s) {
  const me = G.me;
  const d = s.scores[me] - s.scores[1 - me];
  const head = G.spectator ? (d === 0 ? '引き分け' : `${esc(s.names[d > 0 ? me : 1 - me])}の勝ち`) : d > 0 ? '勝ち' : d < 0 ? '負け' : '引き分け';
  openOverlay(`<div class="modal">
    <h2>${head}</h2>
    <table class="score-table"><tr><th></th><th>${esc(s.names[me])}</th><th>${esc(s.names[1 - me])}</th></tr>
      <tr><td>最終</td><td><b style="font-size:22px">${s.scores[me]}</b></td><td><b style="font-size:22px">${s.scores[1 - me]}</b></td></tr></table>
    ${diffText(s)}
    <div class="flow">${flowHTML(s.history, me, s.names)}</div>
    ${fieldMiniHTML(s)}
    ${lookRowHTML()}
    ${G.mode === 'cpu' ? '<p style="font-size:12px;color:var(--ink-soft);text-align:center;margin:0">CPU対戦は戦績に残りません</p>' : ''}
    ${rematchHTML(s)}
    <button class="btn ghost" style="margin-top:10px;color:var(--ink);box-shadow:inset 0 0 0 2px var(--ink)" id="home">メニューへ</button>
  </div>`, { dismiss: false });
  bindLookRow(() => showFinal(G.state));
  const rb = $('#rematch');
  if (rb) {
    rb.onclick = () => {
      if (G.mode === 'cpu') {
        const ns = E.rematchGame(G.state, E.rollDice());
        closeOverlay();
        newMatch({ mode: 'cpu', me: 0, state: ns });
        runDice(ns).then(() => enqueue(() => applyState(E.startRound(G.state))));
        return;
      }
      act((st) => E.requestRematch(st, me), { type: 'rematch' });
    };
  }
  $('#home').onclick = async () => {
    const g = G;
    if (g.spectator) return leaveWatch();
    if (g.mode === 'online' && !(g.state.gone && g.state.gone[me])) {
      // 相手が再戦を待ち続けないように、退出したことを伝える
      await act((st) => E.leaveGame(st, me), { type: 'leave' });
    }
    if (g.unsub) g.unsub();
    if (G === g) G = null;
    closeOverlay();
    showMenu();
  };
}

function rematchHTML(s) {
  const me = G.me;
  if (G.spectator) return '<p class="rematch-note">再戦が始まれば、そのまま観戦を続けます</p>';
  const label = `再戦(${s.settings.months}ヶ月・同じルール)`;
  if (G.mode === 'cpu') return `<button class="btn shu" style="margin-top:14px" id="rematch">${label}</button>`;
  const gone = s.gone && s.gone[1 - me];
  const mine = s.rematch && s.rematch[me];
  const theirs = s.rematch && s.rematch[1 - me];
  if (gone) return '<p class="rematch-note">相手はメニューに戻りました</p><button class="btn shu" style="margin-top:8px" disabled>再戦</button>';
  if (mine) return `<p class="rematch-note">相手の返事を待っています…</p><button class="btn shu" style="margin-top:8px" disabled>${label}</button>`;
  return `${theirs ? `<p class="rematch-note on">${esc(s.names[1 - me])}さんが再戦を希望しています</p>` : ''}<button class="btn shu" style="margin-top:${theirs ? 8 : 14}px" id="rematch">${label}</button>`;
}

// ---------------------------------------------------------------- 戦績
async function showHistory() {
  show(`<section class="page">${pageHead('戦績')}<div class="panel"><p style="margin:0">読み込み中…</p></div></section>`);
  bindBack(showMenu);
  const ms = await loadMatches();
  const uid = app.user.id;
  const st = statsOf(ms);
  const mst = monthStatsOf(ms, uid);
  const byOpp = {};
  for (const m of ms) {
    const me = m.player0 === uid ? 0 : 1;
    const oid = me === 0 ? m.player1 : m.player0;
    const o = byOpp[oid] || (byOpp[oid] = { name: m.names[1 - me], w: 0, l: 0, d: 0, diff: 0, ms: [] });
    o.name = m.names[1 - me];
    o.ms.push(m);
    const diff = m.scores[me] - m.scores[1 - me];
    o.diff += diff;
    if (diff > 0) o.w += 1; else if (diff < 0) o.l += 1; else o.d += 1;
  }
  const sign = (n) => `<span class="${n >= 0 ? 'plus' : 'minus'}">${n > 0 ? '+' : ''}${n}点</span>`;
  show(`<section class="page">
    ${pageHead('戦績')}
    <div class="panel"><h3>通算</h3>
      <div class="stat-label">対局ごと</div>
      <div class="stat-grid"><div><b>${st.n}</b><span>対戦</span></div><div><b>${st.w}</b><span>勝ち</span></div><div><b>${st.l}</b><span>負け</span></div></div>
      <div class="stat-label">月ごと(1回戦ずつ)</div>
      <div class="stat-grid"><div><b>${mst.n}</b><span>月</span></div><div><b>${mst.w}</b><span>勝ち</span></div><div><b>${mst.l}</b><span>負け</span></div></div>
      ${mst.d ? `<p class="stat-note">引き分けの月 ${mst.d}</p>` : ''}
    </div>
    <div class="panel"><h3>相手ごと</h3>
      ${Object.keys(byOpp).length ? `<ul class="list">${Object.values(byOpp).map((o) => `<li><div class="line"><div><b>${esc(o.name)}</b><div class="sub">月ごと ${wlText(monthStatsOf(o.ms, uid))}</div></div><span>${wlText(o)} ・ ${sign(o.diff)}</span></div></li>`).join('')}</ul>` : '<p style="margin:0;color:var(--ink-soft)">まだ対戦がありません</p>'}
    </div>
    <div class="panel"><h3>対局の記録</h3>
      ${ms.length ? `<ul class="list">${ms.map((m, i) => {
        const me = m.player0 === uid ? 0 : 1;
        const diff = m.scores[me] - m.scores[1 - me];
        const ab = m.history.some((h) => h.aborted);
        const played = m.history.filter((h) => !h.aborted).length;
        return `<li><div class="line" data-i="${i}" style="cursor:pointer"><div><b>${esc(m.names[1 - me])}</b><div class="sub">${whenText(m.finished_at)} ・ ${m.months}ヶ月戦${ab ? `(${played}ヶ月で中断)` : ''}</div><div class="sub">${m.scores[me]}対${m.scores[1 - me]} ・ 月ごと ${wlText(monthStatsOf([m], uid))}</div></div>${sign(diff)}</div><div class="flow" data-flow="${i}" hidden></div></li>`;
      }).join('')}</ul>` : '<p style="margin:0;color:var(--ink-soft)">まだ対戦がありません</p>'}
    </div>
  </section>`);
  bindBack(showMenu);
  $$('[data-i]').forEach((row) => {
    row.onclick = () => {
      const i = Number(row.dataset.i);
      const box = $(`[data-flow="${i}"]`);
      if (!box.hidden) { box.hidden = true; return; }
      const m = ms[i];
      const me = m.player0 === uid ? 0 : 1;
      box.innerHTML = flowHTML(m.history, me, m.names);
      box.hidden = false;
    };
  });
}

// ---------------------------------------------------------------- 設定
async function showSettings() {
  const tog = (key) => `<button class="toggle ${prefs[key] ? 'on' : ''}" data-tog="${key}"></button>`;
  const range = (key) => `<input type="range" min="0" max="1" step="0.05" value="${prefs[key]}" data-range="${key}">`;
  show(`<section class="page">
    ${pageHead('設定')}
    <div class="panel">
      <h3>音</h3>
      <div class="setting-row"><label>効果音</label><div class="row">${range('seVol')}${tog('se')}</div></div>
      <div class="setting-row"><label>BGM</label><div class="row">${range('bgmVol')}${tog('bgm')}</div></div>
    </div>
    <div class="panel">
      <h3>操作</h3>
      <div class="setting-row" style="display:block"><label>札の出し方</label>
        <div class="choices two" style="margin-top:8px"><button data-tap="double" class="${prefs.tapMode === 'double' ? 'on' : ''}">ダブルタップ</button><button data-tap="single" class="${prefs.tapMode === 'single' ? 'on' : ''}">1回タップ</button></div></div>
      <div class="setting-row"><label>取れる札を光らせる<small>手札を触ると場の同じ月の札が光る</small></label>${tog('highlight')}</div>
    </div>
    <div class="panel">
      <h3>プロフィール</h3>
      <div class="me-card" style="margin-bottom:12px">${iconHTML(myIcon(), 48)}<div class="name" style="font-size:18px">${esc(myName())}</div></div>
      <button class="btn" id="prof">ニックネームとアイコンを変える</button>
    </div>
    <div class="panel">
      <h3>役の一覧</h3>
      <table class="rules" style="width:100%;border-collapse:collapse">${YAKU_TABLE.map(([n, c, p]) => `<tr><td>${n}</td><td>${c}</td><td>${p}</td></tr>`).join('')}</table>
      <ul style="font-size:13px;padding-left:18px;margin:10px 0 0;line-height:1.6">${RULE_NOTES.map((r) => `<li>${r}</li>`).join('')}</ul>
    </div>
    <p class="muted" style="text-align:center;margin:0">版 ${VERSION}</p>
    <div class="panel"><h3>札の画像について</h3><div class="credits" id="credits">札の画像は Wikimedia Commons の花札SVG(CC BY-SA 4.0)を使っています。アイコンはその札の絵を切り抜いたものです。</div></div>
    ${app.guest ? '<button class="btn ghost" id="login">ログインする</button>' : '<button class="btn ghost" id="logout">ログアウト</button>'}
  </section>`);
  bindBack(showMenu);
  $$('[data-tog]').forEach((b) => { b.onclick = () => { prefs[b.dataset.tog] = !prefs[b.dataset.tog]; savePrefs(); b.classList.toggle('on'); S.pachi(); }; });
  $$('[data-range]').forEach((r) => { r.oninput = () => { prefs[r.dataset.range] = Number(r.value); savePrefs(); }; r.onchange = () => S.pachi(); });
  $$('[data-tap]').forEach((b) => { b.onclick = () => { prefs.tapMode = b.dataset.tap; savePrefs(); $$('[data-tap]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  $('#prof').onclick = () => showProfile(true);
  const lo = $('#logout');
  if (lo) lo.onclick = async () => { await O.signOut(); app.user = null; app.profile = null; showTitle(); };
  const li = $('#login');
  if (li) li.onclick = () => { app.guest = false; showLogin(); };
  try {
    const res = await fetch('images/cards/credits.json');
    if (res.ok) {
      const list = await res.json();
      const artists = [...new Set(list.map((c) => c.artist).filter(Boolean))];
      const lic = [...new Set(list.map((c) => c.license).filter(Boolean))];
      const licUrl = list.find((c) => c.licenseUrl)?.licenseUrl;
      const page = list[0]?.page;
      const box = $('#credits');
      if (box) {
        box.innerHTML = `札の画像: <a href="${esc(page || 'https://commons.wikimedia.org/wiki/Category:SVG_Hanafuda')}" target="_blank" rel="noopener">Wikimedia Commons</a><br>
          作者: ${esc(artists.join(', ') || '不明')}<br>
          ライセンス: ${licUrl ? `<a href="${esc(licUrl)}" target="_blank" rel="noopener">${esc(lic.join(', '))}</a>` : esc(lic.join(', '))}<br>
          改変: アイコンは札の絵を切り抜いて使用。`;
      }
    }
  } catch (e) { /* 画像がまだ無い */ }
}

// ---------------------------------------------------------------- 起動
const supabaseReady = O.initSupabase();
(async function boot() {
  showTitle();
  await supabaseReady;
  // Googleログインから戻ってきたときは、そのまま先へ進む
  if (O.isOnlineReady() && /access_token|code=/.test(location.href + location.hash)) {
    await sleep(300);
    const u = await O.currentUser();
    if (u) {
      const keep = app.roomParam;
      history.replaceState(null, '', location.pathname + (keep ? `?room=${keep}` : ''));
      afterStart();
    }
  }
})();
