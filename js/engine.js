// 対局の進行。状態はただのオブジェクト(JSON)で、Supabase にそのまま保存できる。
// どの関数も元の状態は変えず、新しい状態を返す。
//
// players[0] = 部屋を作った人(CPU対戦では自分)、players[1] = 相手
// phase:
//   'play'       … turn の人が手札を出す番
//   'chooseDraw' … 山札からめくった札で取れる札が2枚あり、どちらを取るか選ぶ
//   'koikoi'     … 役ができたので、こいこいか上がりかを選ぶ
//   'roundEnd'   … その月が終わった(リザルト)
//   'gameEnd'    … 全部の月が終わった
import { ALL_IDS, CARD } from './cards.js?v=20261118-1813';
import { scoreCaptured, finalPoints, DEFAULT_SETTINGS } from './scoring.js?v=20261118-1813';

const clone = (o) => JSON.parse(JSON.stringify(o));

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function rollDice(rand = Math.random) {
  return 1 + Math.floor(rand() * 6);
}

// サイコロの目から最初の親を決める。偶数なら部屋を作った人(0)。
export function oyaFromDice(dice) {
  return dice % 2 === 0 ? 0 : 1;
}

function uuid() {
  if (globalThis.crypto && globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r % 4) + 8).toString(16);
  });
}

export function newGame(settings, dice, names = ['あなた', '相手'], icons = ['tsuru', 'ino']) {
  return {
    v: 1,
    gameId: uuid(), // 戦績を対局ごとに1件ずつ残すための番号
    seq: 0,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    names,
    icons,
    dice,
    month: 1,
    year: 1, // 再戦するたびに1つ増える
    oyaStreak: 1, // いまの親が何ヶ月続けて親か(年をまたいでも数える)
    oya: oyaFromDice(dice),
    turn: oyaFromDice(dice),
    phase: 'dice',
    deck: [],
    field: [],
    hands: [[], []],
    captured: [[], []],
    koi: [false, false],
    lastScore: [0, 0],
    pending: null,
    scores: [0, 0],
    history: [],
    result: null,
    ready: [false, false],
    events: [],
  };
}

function monthCounts(ids) {
  const m = {};
  for (const id of ids) m[CARD[id].month] = (m[CARD[id].month] || 0) + 1;
  return m;
}

// 配られた手札の特殊役
function handYaku(hand) {
  const counts = Object.values(monthCounts(hand));
  if (counts.some((n) => n === 4)) return { key: 'teshi', name: '手四', points: 6 };
  if (counts.filter((n) => n === 2).length === 4) return { key: 'kuttsuki', name: '喰付き', points: 6 };
  return null;
}

// 1か月分を配る。子→場→親の順に2枚ずつ、4周。
export function startRound(state, rand = Math.random) {
  const s = clone(state);
  const oya = s.oya;
  const ko = 1 - oya;
  let redeals = 0;
  let deck;
  let field;
  let hands;
  let order;
  for (;;) {
    deck = shuffle(ALL_IDS, rand);
    field = [];
    hands = [[], []];
    order = [];
    for (let r = 0; r < 4; r += 1) {
      for (const to of ['p' + ko, 'field', 'p' + oya]) {
        const two = [deck.shift(), deck.shift()];
        order.push({ to, ids: two });
        if (to === 'field') field.push(...two);
        else hands[Number(to[1])].push(...two);
      }
    }
    if (Object.values(monthCounts(field)).some((n) => n === 4)) {
      redeals += 1;
      continue;
    }
    break;
  }
  Object.assign(s, {
    deck, field, hands,
    captured: [[], []],
    koi: [false, false],
    firstKoi: null,
    lastScore: [0, 0],
    pending: null,
    result: null,
    ready: [false, false],
    turn: oya,
    phase: 'play',
  });
  s.seq += 1;
  s.events = [{ type: 'deal', order, redeals }];

  // 手四・喰付き(親を優先)
  for (const p of [oya, ko]) {
    const y = handYaku(hands[p]);
    if (y) {
      s.events.push({ type: 'handYaku', p, yaku: y });
      return endRound(s, p, { base: y.points, yaku: [y], reason: y.key });
    }
  }
  return s;
}

function matchesOf(field, id) {
  return field.filter((f) => CARD[f].month === CARD[id].month);
}

// 出した札・めくった札で場から何を取るか。2枚あるときは target が必要。
function takeFromField(s, p, id, target) {
  const m = matchesOf(s.field, id);
  let took = [];
  if (m.length === 0) {
    s.field.push(id);
  } else if (m.length === 1 || m.length === 3) {
    took = m;
  } else {
    if (!m.includes(target)) throw new Error('取る札を選んでください');
    took = [target];
  }
  if (took.length) {
    s.field = s.field.filter((f) => !took.includes(f));
    s.captured[p].push(id, ...took);
  }
  return took;
}

// 手札を出す前に、場で取れる札の候補を返す(UI用)
export function fieldOptions(state, id) {
  return matchesOf(state.field, id);
}

export function playCard(state, p, id, target) {
  if (state.quit) throw new Error('中断の返事を待っています');
  if (state.phase !== 'play' || state.turn !== p) throw new Error('あなたの番ではありません');
  const s = clone(state);
  if (!s.hands[p].includes(id)) throw new Error('その札は手札にありません');
  s.hands[p] = s.hands[p].filter((h) => h !== id);
  const took = takeFromField(s, p, id, target);
  s.seq += 1;
  s.events = [{ type: 'play', p, card: id, took }];
  // 続けて山札を引く(本人がタップして引く)
  s.phase = 'draw';
  return s;
}

// 山札から1枚めくる
export function drawCard(state, p) {
  if (state.quit) throw new Error('中断の返事を待っています');
  if (state.phase !== 'draw' || state.turn !== p) throw new Error('いまは引けません');
  const s = clone(state);
  s.seq += 1;
  const drawn = s.deck.shift();
  const m = matchesOf(s.field, drawn);
  if (m.length === 2) {
    s.phase = 'chooseDraw';
    s.pending = { drawn, options: m };
    s.events = [{ type: 'reveal', p, card: drawn }];
    return s;
  }
  const took = takeFromField(s, p, drawn, null);
  s.events = [{ type: 'draw', p, card: drawn, took }];
  return afterTurn(s, p);
}

export function chooseDraw(state, p, target) {
  if (state.quit) throw new Error('中断の返事を待っています');
  if (state.phase !== 'chooseDraw' || state.turn !== p) throw new Error('選ぶ場面ではありません');
  const s = clone(state);
  const { drawn } = s.pending;
  s.pending = null;
  const took = takeFromField(s, p, drawn, target);
  s.seq += 1;
  s.events = [{ type: 'draw', p, card: drawn, took }];
  return afterTurn(s, p);
}

function afterTurn(s, p) {
  const sc = scoreCaptured(s.captured[p], s.settings);
  if (sc.total > 0 && sc.total > s.lastScore[p]) {
    s.events.push({ type: 'yaku', p, yaku: sc.yaku, total: sc.total });
    // 手札がもう無ければ、こいこいしても次が無いので自動で上がり
    if (s.hands[p].length === 0) {
      return endRound(s, p, { base: sc.total, yaku: sc.yaku, reason: 'agari' });
    }
    s.phase = 'koikoi';
    s.pending = { total: sc.total, yaku: sc.yaku };
    return s;
  }
  return nextTurn(s, p);
}

function nextTurn(s, p) {
  s.pending = null;
  if (s.hands[0].length === 0 && s.hands[1].length === 0) {
    // 引き分け: 点数なし、親はそのまま
    s.phase = 'roundEnd';
    s.result = { winner: null, reason: 'draw', base: 0, points: 0, mult: 1, notes: [], yaku: [], nextOya: s.oya };
    s.history.push({ month: s.month, winner: null, points: 0, reason: 'draw', yaku: [] });
    s.events.push({ type: 'roundEnd' });
    return s;
  }
  s.turn = 1 - p;
  s.phase = 'play';
  return s;
}

export function decide(state, p, choice) {
  if (state.quit) throw new Error('中断の返事を待っています');
  if (state.phase !== 'koikoi' || state.turn !== p) throw new Error('選ぶ場面ではありません');
  const s = clone(state);
  s.seq += 1;
  const { total, yaku } = s.pending;
  if (choice === 'koikoi') {
    if (!s.koi[0] && !s.koi[1]) s.firstKoi = p; // 先にこいこいした人(上がり返しの4倍に使う)
    s.koi[p] = true;
    s.lastScore[p] = total;
    s.events = [{ type: 'koikoi', p }];
    return nextTurn(s, p);
  }
  s.events = [{ type: 'agari', p }];
  return endRound(s, p, { base: total, yaku, reason: 'agari' });
}

function endRound(s, winner, { base, yaku, reason }) {
  const fp = finalPoints(base, s.koi[winner], s.koi[1 - winner], s.firstKoi === winner);
  s.scores[winner] += fp.points;
  s.phase = 'roundEnd';
  s.pending = null;
  s.result = { winner, reason, base, points: fp.points, mult: fp.mult, notes: fp.notes, yaku, nextOya: winner };
  s.history.push({ month: s.month, winner, points: fp.points, reason, yaku: yaku.map((y) => `${y.name}${y.points}`) });
  s.events.push({ type: 'roundEnd' });
  return s;
}

export function setReady(state, p) {
  if (state.quit) throw new Error('中断の返事を待っています');
  if (state.phase !== 'roundEnd') throw new Error('いまは次へ進めません');
  const s = clone(state);
  s.ready[p] = true;
  s.seq += 1;
  s.events = [{ type: 'ready', p }];
  return s;
}

// 次の月へ。最後の月なら gameEnd。
export function nextRound(state, rand = Math.random) {
  if (state.quit) throw new Error('中断の返事を待っています');
  const s = clone(state);
  if (s.month >= s.settings.months) {
    s.phase = 'gameEnd';
    s.seq += 1;
    s.events = [{ type: 'gameEnd' }];
    return s;
  }
  s.month += 1;
  const nextOya = s.result ? s.result.nextOya : s.oya;
  s.oyaStreak = nextOya === s.oya ? (s.oyaStreak || 1) + 1 : 1;
  s.oya = nextOya;
  return startRound(s, rand);
}

// 中断の申請。相手が了承したら対局を終える。申請中は対局が止まる。
export function requestQuit(state, p) {
  if (['gameEnd', 'aborted', 'dice'].includes(state.phase)) throw new Error('いまは中断できません');
  if (state.quit) throw new Error(state.quit.by === p ? '相手の返事を待っています' : '相手から中断の申請が来ています');
  const s = clone(state);
  s.quit = { by: p };
  s.seq += 1;
  s.events = [{ type: 'quitRequest', p }];
  return s;
}

export function answerQuit(state, p, accept) {
  if (!state.quit || state.quit.by === p) throw new Error('答える申請がありません');
  const s = clone(state);
  s.seq += 1;
  if (!accept) {
    s.quit = null;
    s.events = [{ type: 'quitDeclined', p }];
    return s;
  }
  // 終わった月までが結果。途中の月は数えない。
  s.abortedPhase = s.phase;
  s.phase = 'aborted';
  s.quit = { by: state.quit.by, accepted: true };
  s.pending = null;
  s.events = [{ type: 'quitAccepted', p }];
  return s;
}

// 全部の月が終わったあとの再戦。二人とも希望したら、同じ設定で新しい対局を始める。
export function requestRematch(state, p) {
  if (state.phase !== 'gameEnd') throw new Error('まだ対局中です');
  if (state.gone && state.gone[1 - p]) throw new Error('相手はメニューに戻りました');
  const s = clone(state);
  s.rematch = [...(s.rematch || [false, false])];
  s.rematch[p] = true;
  s.seq += 1;
  s.events = [{ type: 'rematch', p }];
  return s;
}

// 最終結果からメニューに戻った(相手の再戦待ちを止めるため)
export function leaveGame(state, p) {
  const s = clone(state);
  s.gone = [...(s.gone || [false, false])];
  s.gone[p] = true;
  if (s.rematch) s.rematch[p] = false;
  s.seq += 1;
  s.events = [{ type: 'left', p }];
  return s;
}

// 再戦の新しい対局。seq は前の対局から続ける(相手の画面が古い状態と取り違えないように)
// 年をまたいでも親は引き継ぐ: 最後の月に上がった人(引き分けなら親のまま)が、次の年も親。
export function rematchGame(state, dice) {
  const s = newGame(state.settings, dice, state.names, state.icons);
  const nextOya = state.result ? state.result.nextOya : state.oya;
  s.oya = nextOya;
  s.turn = nextOya;
  s.oyaStreak = nextOya === state.oya ? (state.oyaStreak || 1) + 1 : 1;
  s.year = (state.year || 1) + 1;
  s.carried = true; // サイコロは振らずに親を引き継いだ
  s.seq = state.seq + 1;
  s.events = [{ type: 'rematchStart' }];
  return s;
}

// 見えていない札(相手の手札か山札のどちらか)
export function unseenFor(state, p) {
  const seen = new Set([...state.hands[p], ...state.field, ...state.captured[0], ...state.captured[1]]);
  if (state.pending && state.pending.drawn) seen.add(state.pending.drawn);
  return ALL_IDS.filter((id) => !seen.has(id));
}

export function currentScore(state, p) {
  return scoreCaptured(state.captured[p], state.settings);
}
