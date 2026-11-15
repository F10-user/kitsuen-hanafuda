import * as E from '../js/engine.js';
import * as CPU from '../js/cpu.js';
import { ALL_IDS } from '../js/cards.js';
import assert from 'node:assert/strict';

function randomBot(s, p) {
  if (s.phase === 'play') { const id = s.hands[p][Math.floor(Math.random()*s.hands[p].length)]; const o = E.fieldOptions(s,id); return E.playCard(s,p,id,o.length===2?o[0]:null); }
  if (s.phase === 'chooseDraw') return E.chooseDraw(s,p,s.pending.options[0]);
  if (s.phase === 'koikoi') return E.decide(s,p,'agari');
}
function cpuBot(s, p) {
  if (s.phase === 'play') { const m = CPU.choosePlay(s,p); return E.playCard(s,p,m.card,m.target); }
  if (s.phase === 'chooseDraw') return E.chooseDraw(s,p,CPU.chooseDrawTarget(s,p));
  if (s.phase === 'koikoi') return E.decide(s,p,CPU.chooseKoikoi(s,p));
}
function check(s) {
  const all = [...s.deck, ...s.field, ...s.hands[0], ...s.hands[1], ...s.captured[0], ...s.captured[1], ...(s.pending?.drawn?[s.pending.drawn]:[])];
  assert.equal(all.length, 48); assert.equal(new Set(all).size, 48);
}
function game(bots) {
  let s = E.newGame({months:12, sakeRule:true}, E.rollDice());
  s = E.startRound(s);
  let steps=0, koikois=0, draws=0, specials=0;
  while (s.phase !== 'gameEnd') {
    if (s.phase === 'roundEnd') { if (!s.result.winner && s.result.winner!==0) draws++; if (['teshi','kuttsuki'].includes(s.result.reason)) specials++; s = E.nextRound(s); continue; }
    check(s);
    s = bots[s.turn](s, s.turn);
    if (s.events.some(e=>e.type==='koikoi')) koikois++;
    if (++steps > 5000) throw new Error('loop');
  }
  return { scores: s.scores, koikois, draws, specials, hist: s.history.length };
}
let cw=0, rw=0, tot=[0,0], k=0, d=0, sp=0;
for (let i=0;i<300;i++) {
  const r = game(i%2 ? [cpuBot, randomBot] : [randomBot, cpuBot]);
  const cpuIdx = i%2 ? 0 : 1;
  tot[0]+=r.scores[cpuIdx]; tot[1]+=r.scores[1-cpuIdx]; k+=r.koikois; d+=r.draws; sp+=r.specials;
  if (r.scores[cpuIdx] > r.scores[1-cpuIdx]) cw++; else if (r.scores[cpuIdx] < r.scores[1-cpuIdx]) rw++;
  assert.equal(r.hist, 12);
}
console.log({cpuWins:cw, randomWins:rw, avgCpu: tot[0]/300, avgRandom: tot[1]/300, koikoisPerGame: k/300, drawsPerGame: d/300, specialsPerGame: sp/300});
// CPU vs CPU
let a=0,b=0; for (let i=0;i<100;i++){ const r=game([cpuBot,cpuBot]); if(r.scores[0]>r.scores[1])a++; else if(r.scores[0]<r.scores[1]) b++; }
console.log('cpu vs cpu', a, b);
