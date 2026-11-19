// 役の判定と点数計算。仕様書「花札こいこい ルール仕様」のとおり。
import { CARD, hasTag } from './cards.js?v=20261120-0420';

export const DEFAULT_SETTINGS = {
  months: 12, // 1 / 3 / 6 / 12
  sakeRule: true, // 小野木戸口ルール(月見花見)
  guide: true, // ガイド: あと1枚でできる役を表示
};

function counts(captured) {
  const c = {
    hikari: 0, tane: 0, tanzaku: 0, kasu: 0,
    rain: false, tsuki: false, maku: false, sake: false,
    ino: false, shika: false, cho: false, akatan: 0, aotan: 0,
  };
  for (const id of captured) {
    const k = CARD[id];
    c[k.type] += 1;
    for (const t of k.tags) {
      if (t === 'akatan' || t === 'aotan') c[t] += 1;
      else c[t] = true;
    }
  }
  return c;
}

// 取り札から成立している役の一覧と合計(倍付け前)を返す
export function scoreCaptured(captured, settings = DEFAULT_SETTINGS) {
  const c = counts(captured);
  const yaku = [];
  const add = (key, name, points) => yaku.push({ key, name, points });

  // 光
  if (c.hikari === 5) add('goko', '五光', 15);
  else if (c.hikari === 4) {
    if (c.rain) add('ameshiko', '雨四光', 7);
    else add('shiko', '四光', 8);
  } else if (c.hikari === 3 && !c.rain) add('sanko', '三光', 5);

  // タネ
  if (c.ino && c.shika && c.cho) {
    add('inoshikacho', '猪鹿蝶', 5 + (c.tane - 3));
  } else if (c.tane >= 5) {
    add('tane', 'タネ', c.tane - 4);
  }

  // タン
  const aka = c.akatan === 3;
  const ao = c.aotan === 3;
  if (aka && ao) add('akaao', '赤短・青短', 10 + (c.tanzaku - 6));
  else if (aka) add('akatan', '赤短', 5 + (c.tanzaku - 3));
  else if (ao) add('aotan', '青短', 5 + (c.tanzaku - 3));
  else if (c.tanzaku >= 5) add('tan', 'タン', c.tanzaku - 4);

  // カス(菊に盃はタネなので入らない)
  if (c.kasu >= 10) add('kasu', 'カス', c.kasu - 9);

  // 月見酒・花見酒
  const tsukimi = c.tsuki && c.sake;
  const hanami = c.maku && c.sake;
  if (tsukimi || hanami) {
    const others = yaku.reduce((s, y) => s + y.points, 0);
    let pts;
    if (!settings.sakeRule) pts = 5;
    else if (tsukimi && hanami) pts = 5; // お互いが「2点以上の役」になる
    else pts = others >= 2 ? 5 : 1;
    if (tsukimi) add('tsukimi', '月見酒', pts);
    if (hanami) add('hanami', '花見酒', pts);
  }

  const total = yaku.reduce((s, y) => s + y.points, 0);
  return { yaku, total };
}

// 上がったときの得点。
//   selfKoi : 上がった本人がこいこいしていたか
//   oppKoi  : 相手がこいこいしていたか
//   selfFirst: 先にこいこいしたのが上がった本人か
// A こいこい → B こいこい返し のあと
//   B が上がる → 2倍(こいこい倍)
//   A が上がり返す → 4倍
export function finalPoints(base, selfKoi, oppKoi, selfFirst = false) {
  let mult = 1;
  const notes = [];
  if (base >= 7) {
    mult *= 2;
    notes.push('7点倍');
  }
  if (oppKoi && selfKoi && selfFirst) {
    mult *= 4;
    notes.push('上がり返し×4');
  } else if (oppKoi) {
    mult *= 2;
    notes.push('こいこい倍');
  }
  return { points: base * mult, mult, notes };
}

// 役の一覧表(設定画面で見せる)
export const YAKU_TABLE = [
  ['五光', '光札5枚', '15点'],
  ['四光', '柳以外の光札4枚', '8点'],
  ['雨四光', '柳を含む光札4枚', '7点'],
  ['三光', '柳以外の光札3枚', '5点'],
  ['猪鹿蝶', '萩に猪・紅葉に鹿・牡丹に蝶', '5点 + 他のタネ1枚ごとに1点'],
  ['赤短', '松・梅・桜の赤短', '5点 + 他のタン1枚ごとに1点'],
  ['青短', '牡丹・菊・紅葉の青短', '5点 + 他のタン1枚ごとに1点'],
  ['赤短・青短', '両方そろう', '10点 + 他のタン1枚ごとに1点'],
  ['月見酒', '芒に月 + 菊に盃', '小野木戸口ルール: ふだん1点。他の役が2点以上あれば5点'],
  ['花見酒', '桜に幕 + 菊に盃', '小野木戸口ルール: ふだん1点。他の役が2点以上あれば5点'],
  ['タネ', 'タネ5枚', '1点 + 1枚ごとに1点(菊に盃はタネのみ)'],
  ['タン', 'タン5枚', '1点 + 1枚ごとに1点'],
  ['カス', 'カス10枚', '1点 + 1枚ごとに1点'],
  ['手四', '配られた手札に同じ月4枚', '6点'],
  ['喰付き', '配られた手札に同じ月2枚のペアが4組', '6点'],
];

export const RULE_NOTES = [
  '月見酒と花見酒を両方そろえると、お互いが条件を満たして合わせて10点。',
  '7点以上で上がると得点が2倍(7点倍)。',
  '相手がこいこいした後に上がると2倍。こいこい返しされた後に、先にこいこいした人が上がり返すと4倍(こいこい返しした側が上がったときは2倍)。7点倍とは掛け算で重なる。',
  '場に同じ月の札が4枚出たら配り直し。雨流れはなし。',
  '引き分けは点数なしで親が続ける。上がった人が次の親。',
];

// ガイド: あと1枚でできる役。dead は相手の取り札(もう取れない札)。
// 例: [{ name: '赤短', text: '赤短まであと1枚' }]
export function nearYaku(captured, dead = []) {
  const mine = new Set(captured);
  const gone = new Set(dead);
  const ids = Object.keys(CARD);
  const has = (pred) => ids.filter((id) => mine.has(id) && pred(CARD[id])).length;
  const open = (pred) => ids.some((id) => !mine.has(id) && !gone.has(id) && pred(CARD[id]));
  const tag = (t) => (c) => c.tags.includes(t);
  const hikari = (c) => c.type === 'hikari';
  const dryHikari = (c) => c.type === 'hikari' && !c.tags.includes('rain');
  const rain = has(tag('rain')) > 0;
  const out = [];
  const add = (name, ok, pred) => { if (ok && open(pred)) out.push({ name, text: `${name}まであと1枚` }); };

  const h = has(hikari);
  add('五光', h === 4, hikari);
  add('四光', !rain && h === 3, dryHikari);
  add('雨四光', rain && h === 3, dryHikari);
  add('三光', !rain && h === 2, dryHikari);

  const isc = (c) => c.tags.some((t) => t === 'ino' || t === 'shika' || t === 'cho');
  add('猪鹿蝶', has(isc) === 2, isc);
  add('赤短', has(tag('akatan')) === 2, tag('akatan'));
  add('青短', has(tag('aotan')) === 2, tag('aotan'));

  const sake = has(tag('sake')) > 0;
  const tsuki = has(tag('tsuki')) > 0;
  const maku = has(tag('maku')) > 0;
  add('月見酒', sake !== tsuki, sake ? tag('tsuki') : tag('sake'));
  add('花見酒', sake !== maku, sake ? tag('maku') : tag('sake'));

  const ino = has(isc) === 3;
  const tan = has(tag('akatan')) === 3 || has(tag('aotan')) === 3;
  add('タネ', !ino && has((c) => c.type === 'tane') === 4, (c) => c.type === 'tane');
  add('タン', !tan && has((c) => c.type === 'tanzaku') === 4, (c) => c.type === 'tanzaku');
  add('カス', has((c) => c.type === 'kasu') === 9, (c) => c.type === 'kasu');
  return out;
}
