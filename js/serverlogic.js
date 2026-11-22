// サーバー(Supabase Edge Function「game」)で使う処理。ブラウザでは読み込まない。
// 本当の盤面はサーバーだけが持ち、プレイヤーには自分の手札だけ見える盤面を渡す。
import * as E from './engine.js?v=20261122-2024';

export const HIDDEN = '?';

const clone = (o) => JSON.parse(JSON.stringify(o));

// 見る人に合わせて伏せた盤面を作る。viewer = 0 / 1(プレイヤー)、null は観戦者
export function viewFor(full, viewer) {
  const v = clone(full);
  v.hands = (full.hands || [[], []]).map((h, q) => (q === viewer ? h : h.map(() => HIDDEN)));
  v.deck = (full.deck || []).map(() => HIDDEN);
  v.events = (full.events || []).map((ev) => {
    if (ev.type !== 'deal') return ev;
    // 配札のアニメーション用の札の並び。場の札と自分に来た札だけ見せる
    return {
      ...ev,
      order: ev.order.map((o) => (o.to === 'field' || o.to === `p${viewer}` ? o : { ...o, ids: o.ids.map(() => HIDDEN) })),
    };
  });
  return v;
}

// 部屋の設定を決まった形にする(変な値が入っていても対局は壊れない)
export function cleanSettings(raw = {}) {
  const months = [1, 3, 6, 12].includes(Number(raw.months)) ? Number(raw.months) : 12;
  return { months, sakeRule: raw.sakeRule !== false, guide: raw.guide !== false };
}

function cryptoRand() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

const ACTIONS = ['start', 'deal', 'play', 'draw', 'choose', 'decide', 'ready', 'quit', 'answerQuit', 'rematch', 'leave'];
export const isAction = (type) => ACTIONS.includes(type);

const idArg = (x) => (x === null || x === undefined ? null : String(x).slice(0, 20));

// プレイヤー p の操作を本当の盤面に当てて、次の盤面を返す。ルールに合わない操作はエラー
//   ctx.settings / names / icons … start のときだけ使う(サーバーが部屋とプロフィールから取る)
export function applyAction(full, p, type, args = {}, ctx = {}) {
  const rand = ctx.rand || cryptoRand;
  if (p !== 0 && p !== 1) throw new Error('この部屋のプレイヤーではありません');
  if (!isAction(type)) throw new Error('知らない操作です');
  if (type === 'start') {
    if (full) throw new Error('もう始まっています');
    return E.newGame(cleanSettings(ctx.settings), E.rollDice(rand), ctx.names, ctx.icons);
  }
  if (!full) throw new Error('まだ始まっていません');
  switch (type) {
    case 'deal':
      // 配るのは部屋を作った人(サイコロの演出が終わってから)
      if (p !== 0) throw new Error('配るのは部屋を作った人です');
      if (full.phase !== 'dice') throw new Error('いまは配れません');
      return E.startRound(full, rand);
    case 'play':
      return E.playCard(full, p, idArg(args.card), idArg(args.target));
    case 'draw':
      return E.drawCard(full, p);
    case 'choose':
      return E.chooseDraw(full, p, idArg(args.target));
    case 'decide':
      if (args.choice !== 'koikoi' && args.choice !== 'agari') throw new Error('こいこいか上がりを選んでください');
      return E.decide(full, p, args.choice);
    case 'ready': {
      // 二人とも「次へ」を押したら、すぐ次の月を配る
      const s = E.setReady(full, p);
      return s.ready[0] && s.ready[1] ? E.nextRound(s, rand) : s;
    }
    case 'quit':
      return E.requestQuit(full, p);
    case 'answerQuit':
      return E.answerQuit(full, p, args.accept === true);
    case 'rematch': {
      const s = E.requestRematch(full, p);
      return s.rematch[0] && s.rematch[1] ? E.rematchGame(s, E.rollDice(rand)) : s;
    }
    case 'leave':
      if (full.phase !== 'gameEnd') throw new Error('まだ対局中です');
      return E.leaveGame(full, p);
    default:
      throw new Error('知らない操作です');
  }
}

// 盤面が変わったことで起きること: 部屋の状態の変更と、戦績の記録
export function effectsOf(prev, next) {
  const was = prev ? prev.phase : null;
  let status = null;
  let match = null;
  if (next.phase === 'dice') status = 'playing';
  if (next.phase === 'gameEnd' && was !== 'gameEnd') {
    status = 'closed';
    match = { room_id: next.gameId, names: next.names, months: next.settings.months, scores: next.scores, history: next.history };
  }
  if (next.phase === 'aborted' && was !== 'aborted') {
    status = 'closed';
    // 終わった月までを残す(途中の月は入れない)。終わった月が無ければ残さない
    if (next.history.length) {
      match = {
        room_id: next.gameId,
        names: next.names,
        months: next.settings.months,
        scores: next.scores,
        history: [...next.history, { month: next.history.length + 1, aborted: true }],
      };
    }
  }
  return { status, match };
}
