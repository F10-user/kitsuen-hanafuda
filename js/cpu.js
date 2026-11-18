// CPU の考え方。
// 見えている情報(場・自分の手札・両者の取り札・まだ出ていない札)だけを使う。
//   1. 取る札の価値 = 自分の役がどれだけ近づくか + 相手の役をどれだけ邪魔できるか
//   2. 場に置いた札を相手に取られる危険も引く
//   3. こいこいは、相手の役の近さと自分の伸びしろを比べて決める
import { CARD } from './cards.js?v=20261118-1813';
import { scoreCaptured } from './scoring.js?v=20261118-1813';
import { unseenFor, fieldOptions } from './engine.js?v=20261118-1813';

// 狙える役ごとに、必要な札の条件と枚数
const TARGETS = [
  { key: 'sanko', pts: 5, need: 3, match: (c) => c.type === 'hikari' && !c.tags.includes('rain') },
  { key: 'goko', pts: 10, need: 5, match: (c) => c.type === 'hikari' },
  { key: 'ino', pts: 5, need: 3, match: (c) => c.tags.some((t) => t === 'ino' || t === 'shika' || t === 'cho') },
  { key: 'aka', pts: 5, need: 3, match: (c) => c.tags.includes('akatan') },
  { key: 'ao', pts: 5, need: 3, match: (c) => c.tags.includes('aotan') },
  { key: 'tsukimi', pts: 3, need: 2, match: (c) => c.tags.includes('tsuki') || c.tags.includes('sake') },
  { key: 'hanami', pts: 3, need: 2, match: (c) => c.tags.includes('maku') || c.tags.includes('sake') },
  { key: 'tane', pts: 1.5, need: 5, match: (c) => c.type === 'tane' },
  { key: 'tan', pts: 1.5, need: 5, match: (c) => c.type === 'tanzaku' },
  { key: 'kasu', pts: 1.5, need: 10, match: (c) => c.type === 'kasu' },
];

// 取り札の「価値」。成立した点数 + 途中の役の近さ。
// dead = もう取れない札(相手が取った札)
function value(captured, dead, settings) {
  const sc = scoreCaptured(captured, settings);
  let v = sc.total * 10;
  const deadSet = new Set(dead);
  for (const t of TARGETS) {
    let have = 0;
    let lost = 0;
    let all = 0;
    for (const id in CARD) {
      if (!t.match(CARD[id])) continue;
      all += 1;
      if (captured.includes(id)) have += 1;
      else if (deadSet.has(id)) lost += 1;
    }
    if (all - lost < t.need) continue; // もう作れない
    const r = Math.min(have, t.need) / t.need;
    v += r * r * t.pts * 6;
  }
  return v;
}

// この札たちを相手が取ったら、相手はどれだけ得するか
function gainFor(captured, otherCaptured, ids, settings) {
  return value([...captured, ...ids], otherCaptured, settings) - value(captured, otherCaptured, settings);
}

// 相手が手札にその月の札を持っている確率(ざっくり)
function oppHoldsMonth(state, p, month) {
  const unseen = unseenFor(state, p);
  const oppHand = state.hands[1 - p].length;
  if (!unseen.length || !oppHand) return 0;
  const k = unseen.filter((id) => CARD[id].month === month).length;
  if (!k) return 0;
  // 1 - (k枚のどれも相手の手札に入っていない確率)
  let none = 1;
  for (let i = 0; i < oppHand; i += 1) none *= Math.max(0, (unseen.length - k - i) / (unseen.length - i));
  return 1 - none;
}

function evalCapture(state, p, ids) {
  const mine = state.captured[p];
  const theirs = state.captured[1 - p];
  const myGain = gainFor(mine, theirs, ids, state.settings);
  const denial = gainFor(theirs, mine, ids, state.settings);
  return myGain + denial * 0.8;
}

function evalPlay(state, p, id, target) {
  const opts = fieldOptions(state, id);
  if (opts.length === 0) {
    // 場に置く: 相手に取られる危険
    const risk = gainFor(state.captured[1 - p], state.captured[p], [id], state.settings) * oppHoldsMonth(state, p, CARD[id].month);
    // 自分がまだ同じ月を持っていれば、次に取り返せる
    const keep = state.hands[p].some((h) => h !== id && CARD[h].month === CARD[id].month) ? 0.5 : 1;
    return -risk * keep - 0.5;
  }
  const took = opts.length === 2 ? [target] : opts;
  let v = evalCapture(state, p, [id, ...took]);
  // 2枚のうち1枚を残すと、相手に残った方を取られるかもしれない
  if (opts.length === 2) {
    const left = opts.find((o) => o !== target);
    v -= gainFor(state.captured[1 - p], state.captured[p], [left], state.settings) * oppHoldsMonth(state, p, CARD[left].month) * 0.7;
  }
  return v + 1;
}

export function choosePlay(state, p) {
  let best = null;
  for (const id of state.hands[p]) {
    const opts = fieldOptions(state, id);
    const targets = opts.length === 2 ? opts : [null];
    for (const t of targets) {
      const v = evalPlay(state, p, id, t);
      if (!best || v > best.v) best = { v, card: id, target: t };
    }
  }
  return { card: best.card, target: best.target };
}

export function chooseDrawTarget(state, p) {
  const { drawn, options } = state.pending;
  let best = null;
  for (const t of options) {
    const left = options.find((o) => o !== t);
    const v = evalCapture(state, p, [drawn, t])
      - gainFor(state.captured[1 - p], state.captured[p], [left], state.settings) * oppHoldsMonth(state, p, CARD[left].month) * 0.7;
    if (!best || v > best.v) best = { v, t };
  }
  return best.t;
}

// あと1枚で成立しそうな役(取れる札がまだ残っているもの)の点数合計
function nearYaku(captured, otherCaptured) {
  const other = new Set(otherCaptured);
  let pts = 0;
  for (const t of TARGETS) {
    if (t.key === 'goko') continue;
    let have = 0;
    let open = 0;
    for (const id in CARD) {
      if (!t.match(CARD[id])) continue;
      if (captured.includes(id)) have += 1;
      else if (!other.has(id)) open += 1;
    }
    if (have < t.need && have >= t.need - 1 && open > 0) pts += t.pts;
  }
  return pts;
}

export function chooseKoikoi(state, p) {
  const base = state.pending.total;
  const handLeft = state.hands[p].length;
  const oppKoi = state.koi[1 - p];
  const mine = state.captured[p];
  const theirs = state.captured[1 - p];

  if (oppKoi) return 'agari'; // 相手がこいこい中なら倍で確定させる
  if (base >= 7) return 'agari'; // 7点倍が付く
  if (handLeft <= 2) return 'agari';

  const oppScore = scoreCaptured(theirs, state.settings).total;
  const threat = nearYaku(theirs, mine) + oppScore * 2;
  const upside = nearYaku(mine, theirs);

  // 7点に届けば倍になるので、あと少しなら粘る価値が上がる
  const toSeven = 7 - base;
  if (threat === 0 && upside >= 1.5 && handLeft >= 4) return 'koikoi';
  if (threat <= 1.5 && upside >= 3 && toSeven <= upside && handLeft >= 3) return 'koikoi';
  return 'agari';
}
