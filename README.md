# 喫煙所花札

友達とスマホでオンライン対戦できる「こいこい」。CPU対戦もできます。

遊ぶURL: https://f10-user.github.io/kitsuen-hanafuda/

## 最初にやること

上から順に1回ずつやれば動きます。プログラミングの知識はいりません。

### 1. GitHub Pages をオンにする
1. このリポジトリの「Settings」→ 左の「Pages」
2. 「Branch」を **main**、フォルダを **/(root)** にして「Save」
3. 1〜2分で上のURLが開けるようになる

この時点で、CPU対戦は遊べます(ログイン画面の「ログインせずにCPUと遊ぶ」)。

### 2. 札の画像を入れる
1. このリポジトリの「Actions」タブを開く
2. 左の「札の画像を取ってくる」→ 右の「Run workflow」→ 緑の「Run workflow」
3. 1分ほどで `images/cards/` に48枚のSVGが入る

画像が無いあいだは、月と札の名前を書いた代わりの札が表示されます。

### 3. Supabase に表を作る
1. Supabase のプロジェクトを開き、左の「SQL Editor」
2. `supabase/schema.sql` の中身を全部貼り付けて「Run」

### 観戦モードを使えるようにする(すでに3をやった人も)
`supabase/schema.sql` をもう一度全部貼り付けて「Run」を押す。観戦用の列と関数が足されます。何度実行しても大丈夫です。

観戦する人は「ゲームスタート」→「観戦する」で、対局している部屋の6桁コードを入れます。観戦中は両方の手札が伏せたままで、場と取り札だけ見えます。上の「入替」で上下を入れ替えられます。

### 4. Googleログインをつなぐ
少し画面が多いので、迷ったらスクショを撮って Claude に見せてください。

1. https://console.cloud.google.com/ を開き、新しいプロジェクトを作る
2. 「APIとサービス」→「OAuth 同意画面」で、アプリ名(喫煙所花札)とメールを入れて作る。「外部」を選ぶ
3. 「認証情報」→「認証情報を作成」→「OAuth クライアント ID」→ 種類は「ウェブ アプリケーション」
4. 「承認済みのリダイレクト URI」に次を追加して作成
   `https://aivkyyfdwpurhfiglazp.supabase.co/auth/v1/callback`
5. 出てきた「クライアント ID」と「クライアント シークレット」を、Supabase の「Authentication」→「Sign In / Providers」→「Google」に貼って有効にする
6. Supabase の「Authentication」→「URL Configuration」で
   - Site URL: `https://f10-user.github.io/kitsuen-hanafuda/`
   - Redirect URLs に同じURLを追加

### 5. (好みで)BGMを差し替える
`assets/bgm.mp3` を置くと、その曲がBGMになります。置かなければ、アプリの中で作った箏っぽいBGMが流れます。

## ファイルの中身

| ファイル | 役割 |
| --- | --- |
| `index.html` | 入口 |
| `css/style.css` | 見た目 |
| `js/cards.js` | 48枚の札のデータ |
| `js/scoring.js` | 役と点数の計算(小野木戸口ルール込み) |
| `js/engine.js` | 配札・手番・こいこい・月の進行 |
| `js/cpu.js` | CPUの考え方 |
| `js/online.js` | Supabase(ログイン・部屋・同期・戦績) |
| `js/app.js` | 画面と操作 |
| `js/sound.js` | 効果音とBGM |
| `js/config.js` | Supabase の接続先 |
| `supabase/schema.sql` | Supabase の表と権限 |
| `tools/fetch_cards.py` | 札の画像を取ってくるスクリプト |

ルールのテストは `node tests/scoring.test.mjs` と `node tests/sim.test.mjs` で動きます。

## 札の画像について

札の画像は Wikimedia Commons の花札SVG(CC BY-SA 4.0)を使っています。作者とライセンスは `images/cards/credits.json` に保存され、アプリの「設定」→「札の画像について」にも表示されます。アイコンは札の絵を切り抜いて使っています。
