"""Wikimedia Commons から花札48枚のSVGを取ってきて images/cards/ に保存する。

GitHub Actions(.github/workflows/fetch-cards.yml)から1回動かせばよい。
自分のパソコンで動かす場合: python tools/fetch_cards.py
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
OUT = os.path.join(os.path.dirname(__file__), "..", "images", "cards")
UA = "kitsuen-hanafuda-card-fetcher/1.0 (https://github.com/F10-user/kitsuen-hanafuda)"

MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]
PATTERN = re.compile(
    r"^File:Hanafuda[ _](%s)[ _-](hikari|tane|tanzaku|kasu)(?:[ _-]?(\d))?(?:[ _-](alt))?\.svg$" % "|".join(MONTHS),
    re.IGNORECASE,
)

# このアプリの札ID(js/cards.js と同じ)
EXPECTED = {
    1: ["hikari", "tanzaku", "kasu1", "kasu2"], 2: ["tane", "tanzaku", "kasu1", "kasu2"],
    3: ["hikari", "tanzaku", "kasu1", "kasu2"], 4: ["tane", "tanzaku", "kasu1", "kasu2"],
    5: ["tane", "tanzaku", "kasu1", "kasu2"], 6: ["tane", "tanzaku", "kasu1", "kasu2"],
    7: ["tane", "tanzaku", "kasu1", "kasu2"], 8: ["hikari", "tane", "kasu1", "kasu2"],
    9: ["tane", "tanzaku", "kasu1", "kasu2"], 10: ["tane", "tanzaku", "kasu1", "kasu2"],
    11: ["hikari", "tane", "tanzaku", "kasu1"], 12: ["hikari", "kasu1", "kasu2", "kasu3"],
}


def api(params):
    params = {**params, "format": "json", "formatversion": "2"}
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def list_titles():
    titles = set()
    for prefix in ["Hanafuda ", "Hanafuda_"]:
        cont = {}
        while True:
            data = api({"action": "query", "list": "allimages", "aiprefix": prefix.replace(" ", "_"),
                        "ailimit": "500", **cont})
            for im in data["query"]["allimages"]:
                titles.add("File:" + im["name"].replace("_", " "))
            if "continue" not in data:
                break
            cont = data["continue"]
    cont = {}
    while True:
        data = api({"action": "query", "list": "categorymembers", "cmtitle": "Category:SVG Hanafuda",
                    "cmtype": "file", "cmlimit": "500", **cont})
        for m in data["query"]["categorymembers"]:
            titles.add(m["title"])
        if "continue" not in data:
            break
        cont = data["continue"]
    return titles


def main():
    titles = list_titles()
    print(f"Commons で {len(titles)} 件の候補を見つけました")
    variants = {}  # variant -> {card_id: title}
    for t in sorted(titles):
        m = PATTERN.match(t)
        if not m:
            continue
        month = MONTHS.index(m.group(1).lower()) + 1
        kind = m.group(2).lower()
        num = m.group(3)
        variant = (m.group(4) or "").lower()
        key = kind if kind != "kasu" else f"kasu{num or 1}"
        if key not in EXPECTED[month]:
            continue
        variants.setdefault(variant, {})[f"{month:02d}-{key}"] = t

    if not variants:
        sys.exit("花札のSVGが見つかりませんでした")
    # いちばん多くそろっている組を使い、足りない分を他の組で補う
    order = sorted(variants, key=lambda v: -len(variants[v]))
    chosen = {}
    for v in order:
        for cid, t in variants[v].items():
            chosen.setdefault(cid, t)
    missing = [f"{m:02d}-{k}" for m, ks in EXPECTED.items() for k in ks if f"{m:02d}-{k}" not in chosen]
    print(f"使う組: {order[0] or '(標準)'} / そろった枚数: {len(chosen)} / 足りない: {missing}")

    os.makedirs(OUT, exist_ok=True)
    credits = []
    items = sorted(chosen.items())
    for i in range(0, len(items), 40):
        batch = items[i:i + 40]
        data = api({"action": "query", "prop": "imageinfo", "iiprop": "url|extmetadata",
                    "titles": "|".join(t for _, t in batch)})
        info = {p["title"]: p["imageinfo"][0] for p in data["query"]["pages"] if "imageinfo" in p}
        for cid, title in batch:
            ii = info.get(title)
            if not ii:
                print("情報なし:", title)
                continue
            req = urllib.request.Request(ii["url"], headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            with open(os.path.join(OUT, cid + ".svg"), "wb") as f:
                f.write(body)
            meta = ii.get("extmetadata", {})
            strip = lambda s: re.sub(r"<[^>]+>", "", s or "").strip()
            credits.append({
                "card": cid,
                "file": title,
                "page": ii.get("descriptionurl"),
                "artist": strip(meta.get("Artist", {}).get("value")),
                "license": strip(meta.get("LicenseShortName", {}).get("value")),
                "licenseUrl": meta.get("LicenseUrl", {}).get("value"),
            })
            print("保存:", cid, "<-", title)
            time.sleep(0.2)

    with open(os.path.join(OUT, "credits.json"), "w", encoding="utf-8") as f:
        json.dump(credits, f, ensure_ascii=False, indent=1)
    print(f"{len(credits)} 枚を保存しました")


if __name__ == "__main__":
    main()
