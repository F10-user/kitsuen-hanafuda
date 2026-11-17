import { nearYaku } from '../js/scoring.js';
import * as E from '../js/engine.js';
import assert from 'node:assert/strict';
const names = (ids, dead) => nearYaku(ids, dead).map((y) => y.name).sort().join(',');
assert.equal(names(['01-tanzaku','02-tanzaku']), '赤短');
assert.equal(names(['01-tanzaku','02-tanzaku'], ['03-tanzaku']), '');          // 相手が取ったら出さない
assert.equal(names(['01-hikari','03-hikari']), ['三光','花見酒'].sort().join(','));
assert.equal(names(['01-hikari','11-hikari','12-hikari']), '雨四光');
assert.equal(names(['01-hikari','03-hikari','12-hikari']), ['四光','花見酒'].sort().join(','));
assert.equal(names(['01-hikari','03-hikari','08-hikari','11-hikari']), ['五光','月見酒','花見酒'].sort().join(','));
assert.equal(names(['07-tane','10-tane']), '猪鹿蝶');
assert.equal(names(['09-tane']), ['月見酒','花見酒'].sort().join(','));
assert.equal(names(['09-tane','08-hikari']), '花見酒');
assert.equal(names(['02-tane','04-tane','05-tane','08-tane']), 'タネ');
assert.equal(names(['01-tanzaku','04-tanzaku','05-tanzaku','07-tanzaku']), 'タン');
const kasu = ['01-kasu1','01-kasu2','02-kasu1','02-kasu2','03-kasu1','03-kasu2','04-kasu1','04-kasu2','05-kasu1'];
assert.equal(names(kasu), 'カス');
console.log('nearYaku ok');

// 中断
let s = E.startRound(E.newGame({ months: 3 }, 2));
const t = s.turn;
s = E.requestQuit(s, 1 - t);
assert.throws(() => E.playCard(s, t, s.hands[t][0], null), /中断/);
assert.throws(() => E.requestQuit(s, t), /申請/);
assert.throws(() => E.answerQuit(s, 1 - t, true), /申請がありません/);
let d = E.answerQuit(s, t, false);
assert.equal(d.quit, null);
assert.equal(d.events[0].type, 'quitDeclined');
E.playCard(d, t, d.hands[t][0], E.fieldOptions(d, d.hands[t][0])[0]); // 断られたら続けられる
let a = E.answerQuit(E.requestQuit(d, t), 1 - t, true);
assert.equal(a.phase, 'aborted');
assert.equal(a.history.length, 0);
console.log('quit ok');

// 再戦
{
  let g = E.newGame({ months: 1 }, 3, ['A', 'B']);
  assert.match(g.gameId, /^[0-9a-f-]{36}$/);
  g.phase = 'gameEnd';
  assert.throws(() => E.requestRematch({ ...g, phase: 'play' }, 0), /対局中/);
  let r = E.requestRematch(g, 0);
  r = E.requestRematch(r, 1);
  assert.deepEqual(r.rematch, [true, true]);
  const n = E.rematchGame(r, 4);
  assert.equal(n.phase, 'dice');
  assert.ok(n.seq > r.seq);
  assert.notEqual(n.gameId, g.gameId);
  assert.deepEqual(n.names, ['A', 'B']);
  const left = E.leaveGame(E.requestRematch(g, 0), 1);
  assert.throws(() => E.requestRematch(left, 0), /メニューに戻りました/);
  console.log('rematch ok');
}

// 年をまたいだ親の引き継ぎ
{
  let g = E.newGame({ months: 1 }, 2, ['A', 'B']); // 偶数 → A(0)が親
  assert.equal(g.oya, 0);
  g.phase = 'gameEnd';
  g.result = { nextOya: 0 }; // 最後の月も親が上がった
  let n = E.rematchGame(g, 3); // サイコロは奇数でも無視
  assert.equal(n.oya, 0); assert.equal(n.turn, 0);
  assert.equal(n.oyaStreak, 2); assert.equal(n.year, 2); assert.ok(n.carried);
  n.phase = 'gameEnd'; n.result = { nextOya: 1 }; // 子が上がった
  const n2 = E.rematchGame(n, 2);
  assert.equal(n2.oya, 1); assert.equal(n2.oyaStreak, 1); assert.equal(n2.year, 3);
  // 月をまたぐ連チャン
  let s = E.startRound(E.newGame({ months: 3 }, 2));
  s.phase = 'roundEnd'; s.result = { nextOya: s.oya };
  const s2 = E.nextRound(s);
  assert.equal(s2.oyaStreak, 2);
  console.log('oya carry ok');
}

// こいこい返し: Aこいこい → Bこいこい返し → Bが上がると2倍、Aが上がり返すと4倍
{
  const base = E.startRound(E.newGame({ months: 1 }, 2));
  const A = base.oya; const B = 1 - A;
  const koiAt = (st, p, total) => ({ ...st, phase: 'koikoi', turn: p, quit: null, pending: { total, yaku: [{ name: 'テスト', points: total }] } });
  let s = E.decide(koiAt(base, A, 3), A, 'koikoi');
  assert.equal(s.firstKoi, A);
  s = E.decide(koiAt(s, B, 3), B, 'koikoi');
  assert.equal(s.firstKoi, A);
  const bWins = E.decide(koiAt(s, B, 4), B, 'agari');
  assert.equal(bWins.result.points, 8); assert.deepEqual(bWins.result.notes, ['こいこい倍']);
  const aWins = E.decide(koiAt(s, A, 4), A, 'agari');
  assert.equal(aWins.result.points, 16); assert.deepEqual(aWins.result.notes, ['上がり返し×4']);
  const a7 = E.decide(koiAt(s, A, 7), A, 'agari');
  assert.equal(a7.result.points, 56);
  // こいこい返しなし(Bがそのまま上がる)は2倍
  const s1 = E.decide(koiAt(base, A, 3), A, 'koikoi');
  assert.equal(E.decide(koiAt(s1, B, 4), B, 'agari').result.points, 8);
  // 次の月に持ち越さない
  assert.equal(E.nextRound({ ...aWins, settings: { ...aWins.settings, months: 2 } }).firstKoi ?? null, null);
  console.log('koikoi gaeshi ok');
}
