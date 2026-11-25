// サーバー側の処理のテスト。
//   ・プレイヤーに渡す盤面に、相手の手札と山札が一切入っていないこと
//   ・自分の盤面だけを見て最後まで遊べること
//   ・ルールに合わない操作がはねられること
//   ・戦績が対局の結果どおりに作られること
import assert from 'node:assert/strict';
import { applyAction, viewFor, effectsOf, cleanSettings, peekFor, HIDDEN } from '../js/serverlogic.js';
import * as E from '../js/engine.js';
import { fieldOptions } from '../js/engine.js';

function secretIds(full, viewer) {
  const ids = [...full.deck];
  for (const q of [0, 1]) if (q !== viewer) ids.push(...full.hands[q]);
  return ids;
}

function assertNoLeak(full) {
  for (const viewer of [0, 1, null]) {
    const json = JSON.stringify(viewFor(full, viewer));
    for (const id of secretIds(full, viewer)) {
      assert.ok(!json.includes(`"${id}"`), `見えてはいけない札 ${id} が viewer=${viewer} に見えている (phase=${full.phase})`);
    }
  }
  // 配札のときに配られた札(配った直後は手札そのもの)も伏せてあること
  const deal = (full.events || []).find((e) => e.type === 'deal');
  if (deal) {
    const v = viewFor(full, null);
    for (const o of v.events.find((e) => e.type === 'deal').order) {
      if (o.to !== 'field') assert.deepEqual(o.ids, [HIDDEN, HIDDEN]);
    }
  }
}

// 自分の盤面(view)だけを見て次の操作を決める
function botMove(view, p) {
  if (view.phase === 'play') {
    const hand = view.hands[p];
    assert.ok(hand.every((id) => id !== HIDDEN), '自分の手札は見えている');
    const card = hand[Math.floor(Math.random() * hand.length)];
    const o = fieldOptions(view, card);
    return ['play', { card, target: o.length === 2 ? o[1] : null }];
  }
  if (view.phase === 'draw') return ['draw', {}];
  if (view.phase === 'chooseDraw') return ['choose', { target: view.pending.options[0] }];
  if (view.phase === 'koikoi') return ['decide', { choice: Math.random() < 0.5 ? 'koikoi' : 'agari' }];
  return null;
}

const ctx = { settings: { months: 12, sakeRule: true, guide: true }, names: ['ホスト', 'ゲスト'], icons: ['tsuru', 'ino'] };

function playGame({ quitAt = null } = {}) {
  let full = applyAction(null, 0, 'start', {}, ctx);
  let fx = effectsOf(null, full);
  assert.equal(fx.status, 'playing');
  assert.throws(() => applyAction(full, 1, 'deal'), /部屋を作った人/);
  full = applyAction(full, 0, 'deal');
  let steps = 0;
  const matches = [];
  while (full.phase !== 'gameEnd' && full.phase !== 'aborted') {
    assertNoLeak(full);
    if (++steps > 20000) throw new Error('終わらない');
    if (quitAt !== null && full.month === quitAt && full.phase === 'play' && !full.quit) {
      const prev = full;
      full = applyAction(full, 1, 'quit');
      assert.throws(() => applyAction(full, full.turn, 'draw'), /中断/);
      assert.throws(() => applyAction(full, 1, 'answerQuit', { accept: true }), /答える申請/);
      full = applyAction(full, 0, 'answerQuit', { accept: true });
      fx = effectsOf(prev, full);
      if (fx.match) matches.push(fx.match);
      assert.equal(fx.status, 'closed');
      break;
    }
    if (full.phase === 'roundEnd') {
      const prev = full;
      full = applyAction(full, 1, 'ready');
      assert.equal(full.phase, 'roundEnd');
      full = applyAction(full, 0, 'ready');
      fx = effectsOf(prev, full);
      if (fx.match) matches.push(fx.match);
      continue;
    }
    const p = full.turn;
    const other = 1 - p;
    // 相手の番には何もできない
    assert.throws(() => applyAction(full, other, 'draw'));
    // 自分の盤面からの操作
    const mv = botMove(viewFor(full, p), p);
    full = applyAction(full, p, mv[0], mv[1]);
  }
  return { full, matches };
}

// 1. 普通に最後まで
for (let i = 0; i < 40; i += 1) {
  const { full, matches } = playGame();
  assert.equal(full.phase, 'gameEnd');
  assert.equal(matches.length, 1, '戦績はちょうど1件');
  assert.deepEqual(matches[0].scores, full.scores);
  assert.equal(matches[0].history.length, 12);
  assert.equal(matches[0].room_id, full.gameId);
  // 再戦
  let s = applyAction(full, 0, 'rematch');
  assert.equal(s.phase, 'gameEnd');
  s = applyAction(s, 1, 'rematch');
  assert.equal(s.phase, 'dice');
  assert.equal(effectsOf(full, s).status, 'playing');
  assert.notEqual(s.gameId, full.gameId);
  assert.ok(s.seq > full.seq);
}

// 2. 途中で中断
for (let i = 0; i < 20; i += 1) {
  const quitAt = 1 + (i % 4);
  const { full, matches } = playGame({ quitAt });
  assert.equal(full.phase, 'aborted');
  if (full.history.length) {
    assert.equal(matches.length, 1);
    assert.equal(matches[0].history.at(-1).aborted, true);
  } else {
    assert.equal(matches.length, 0, '終わった月が無ければ残さない');
  }
}

// 3. 手札にない札、変な操作
{
  let s = applyAction(null, 0, 'start', {}, ctx);
  s = applyAction(s, 0, 'deal');
  if (s.phase === 'play') {
    const p = s.turn;
    const notMine = s.hands[1 - p][0];
    assert.throws(() => applyAction(s, p, 'play', { card: notMine }), /手札にありません/);
    assert.throws(() => applyAction(s, p, 'play', { card: '?' }), /手札にありません/);
    assert.throws(() => applyAction(s, p, 'teleport'), /知らない操作/);
    assert.throws(() => applyAction(s, 2, 'draw'), /プレイヤーではありません/);
    assert.throws(() => applyAction(s, p, 'decide', { choice: 'win' }));
    assert.throws(() => applyAction(s, p, 'leave'), /対局中/);
    assert.throws(() => applyAction(s, 0, 'start', {}, ctx), /もう始まって/);
  }
}

// 4. 設定の掃除
assert.deepEqual(cleanSettings({ months: 99, sakeRule: 'x', guide: false, hack: 1 }), { months: 12, sakeRule: true, guide: false });
assert.deepEqual(cleanSettings({ months: '3' }), { months: 3, sakeRule: true, guide: true });

// 5. 先回り: 自分の盤面(と、引く本人にだけ教える山札の一番上)だけで計算した次の盤面が、
//    サーバーの盤面を本人向けに伏せたものと同じ手になること
{
  const same = (a, b) => a.phase === b.phase && a.turn === b.turn && JSON.stringify(a.events) === JSON.stringify(b.events)
    && JSON.stringify(a.hands) === JSON.stringify(b.hands) && JSON.stringify(a.field) === JSON.stringify(b.field)
    && JSON.stringify(a.captured) === JSON.stringify(b.captured) && JSON.stringify(a.scores) === JSON.stringify(b.scores);
  let checked = 0;
  for (let i = 0; i < 30; i += 1) {
    let full = applyAction(applyAction(null, 0, 'start', {}, ctx), 0, 'deal');
    let peek = null;
    while (full.phase !== 'gameEnd') {
      if (full.phase === 'roundEnd') { full = applyAction(applyAction(full, 1, 'ready'), 0, 'ready'); continue; }
      const p = full.turn;
      // 山札の一番上は、引くことが決まった本人にしか返さない
      assert.equal(peekFor(full, 1 - p), null);
      if (full.phase !== 'draw') assert.equal(peekFor(full, p), null);
      const view = viewFor(full, p);
      const [type, args] = botMove(view, p);
      let local;
      if (type === 'play') local = E.playCard(view, p, args.card, args.target);
      if (type === 'draw') local = E.drawCard({ ...view, deck: [peek, ...view.deck.slice(1)] }, p);
      if (type === 'choose') local = E.chooseDraw(view, p, args.target);
      if (type === 'decide') local = E.decide(view, p, args.choice);
      full = applyAction(full, p, type, args);
      const mine = viewFor(full, p);
      assert.equal(local.seq, mine.seq);
      assert.ok(same(local, mine), `先回りの盤面がサーバーと違う (${type})`);
      peek = peekFor(full, p);
      if (full.phase === 'draw') assert.equal(peek, full.deck[0]);
      checked += 1;
    }
  }
  assert.ok(checked > 1000);
}

console.log('server ok');
