// 花札48枚のデータ。
// id は "01-hikari" のように「月-種類」。カスが複数ある月は kasu1, kasu2 ...
// 画像は images/cards/<id>.svg に置く(tools/fetch_cards.py が Wikimedia Commons から取ってくる)。

export const MONTH_PLANTS = [
  '', '松', '梅', '桜', '藤', '菖蒲', '牡丹', '萩', '芒', '菊', '紅葉', '柳', '桐',
];

export const TYPE_LABEL = { hikari: '光', tane: 'タネ', tanzaku: 'タン', kasu: 'カス' };

// tags: 役判定に使う目印
//   rain   … 柳に小野道風(雨)
//   tsuki  … 芒に月 / maku … 桜に幕 / sake … 菊に盃
//   ino, shika, cho … 猪鹿蝶
//   akatan, aotan  … 赤短・青短
const RAW = [
  [1, 'hikari', '松に鶴', []],
  [1, 'tanzaku', '松に赤短', ['akatan']],
  [1, 'kasu', '松のカス', []],
  [1, 'kasu', '松のカス', []],
  [2, 'tane', '梅に鶯', []],
  [2, 'tanzaku', '梅に赤短', ['akatan']],
  [2, 'kasu', '梅のカス', []],
  [2, 'kasu', '梅のカス', []],
  [3, 'hikari', '桜に幕', ['maku']],
  [3, 'tanzaku', '桜に赤短', ['akatan']],
  [3, 'kasu', '桜のカス', []],
  [3, 'kasu', '桜のカス', []],
  [4, 'tane', '藤に不如帰', []],
  [4, 'tanzaku', '藤に短冊', []],
  [4, 'kasu', '藤のカス', []],
  [4, 'kasu', '藤のカス', []],
  [5, 'tane', '菖蒲に八橋', []],
  [5, 'tanzaku', '菖蒲に短冊', []],
  [5, 'kasu', '菖蒲のカス', []],
  [5, 'kasu', '菖蒲のカス', []],
  [6, 'tane', '牡丹に蝶', ['cho']],
  [6, 'tanzaku', '牡丹に青短', ['aotan']],
  [6, 'kasu', '牡丹のカス', []],
  [6, 'kasu', '牡丹のカス', []],
  [7, 'tane', '萩に猪', ['ino']],
  [7, 'tanzaku', '萩に短冊', []],
  [7, 'kasu', '萩のカス', []],
  [7, 'kasu', '萩のカス', []],
  [8, 'hikari', '芒に月', ['tsuki']],
  [8, 'tane', '芒に雁', []],
  [8, 'kasu', '芒のカス', []],
  [8, 'kasu', '芒のカス', []],
  [9, 'tane', '菊に盃', ['sake']],
  [9, 'tanzaku', '菊に青短', ['aotan']],
  [9, 'kasu', '菊のカス', []],
  [9, 'kasu', '菊のカス', []],
  [10, 'tane', '紅葉に鹿', ['shika']],
  [10, 'tanzaku', '紅葉に青短', ['aotan']],
  [10, 'kasu', '紅葉のカス', []],
  [10, 'kasu', '紅葉のカス', []],
  [11, 'hikari', '柳に小野道風', ['rain']],
  [11, 'tane', '柳に燕', []],
  [11, 'tanzaku', '柳に短冊', []],
  [11, 'kasu', '柳に雷', []],
  [12, 'hikari', '桐に鳳凰', []],
  [12, 'kasu', '桐のカス', []],
  [12, 'kasu', '桐のカス', []],
  [12, 'kasu', '桐のカス', []],
];

function buildCards() {
  const list = [];
  const kasuCount = {};
  for (const [month, type, name, tags] of RAW) {
    const mm = String(month).padStart(2, '0');
    let id = `${mm}-${type}`;
    if (type === 'kasu') {
      kasuCount[month] = (kasuCount[month] || 0) + 1;
      id = `${mm}-kasu${kasuCount[month]}`;
    }
    list.push({ id, month, type, name, tags });
  }
  return list;
}

export const CARDS = buildCards();
export const CARD = Object.fromEntries(CARDS.map((c) => [c.id, c]));
export const ALL_IDS = CARDS.map((c) => c.id);

export function card(id) {
  return CARD[id];
}

export function hasTag(id, tag) {
  return CARD[id].tags.includes(tag);
}

export function sameMonth(a, b) {
  return CARD[a].month === CARD[b].month;
}

export function cardImage(id) {
  return `images/cards/${id}.svg`;
}

// 手札や取り札を見やすく並べるための順番(月→光タネタンカス)
const TYPE_ORDER = { hikari: 0, tane: 1, tanzaku: 2, kasu: 3 };
export function sortCards(ids) {
  return [...ids].sort((a, b) => {
    const ca = CARD[a];
    const cb = CARD[b];
    return ca.month - cb.month || TYPE_ORDER[ca.type] - TYPE_ORDER[cb.type] || a.localeCompare(b);
  });
}
