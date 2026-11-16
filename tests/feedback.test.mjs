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
