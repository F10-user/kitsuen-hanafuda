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

### 3. Supabase に表とサーバーの処理を入れる
対局の判定はSupabaseのサーバー(Edge Function「game」)でやります。GitHub Actions から自動で入れるので、鍵を1つ登録するだけです。

1. https://supabase.com/dashboard/account/tokens を開き「Generate new token」。名前は `github-actions` などで作り、出てきた `sbp_` で始まる文字列をコピーする(この画面を閉じると二度と見られない)
2. このリポジトリの「Settings」→ 左の「Secrets and variables」→「Actions」→「New repository secret」
   - Name: `SUPABASE_ACCESS_TOKEN`
   - Secret: 1でコピーした文字列
3. 「Actions」タブ → 左の「サーバーの処理を更新する」→ 右の「Run workflow」→ 緑の「Run workflow」
4. 2〜3分で緑のチェックが付けば完了。赤くなったらスクショを撮って Claude に見せてください

このあとは、ルールのファイル(`js/engine.js` など)や `supabase/` を変えて push すると自動で更新されます。

うまくいかないときの手作業: Supabase の「SQL Editor」に `supabase/schema.sql` を全部貼って「Run」すると、表と権限だけは入ります(何度実行しても大丈夫)。

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
| `js/online.js` | Supabase(ログイン・部屋・同期・戦績の読み込み) |
| `js/serverlogic.js` | サーバーで使う処理(操作の判定、手札を伏せた盤面づくり) |
| `supabase/functions/game/index.ts` | サーバー(Edge Function)。対局中の操作はすべてここを通る |
| `js/app.js` | 画面と操作 |
| `js/sound.js` | 効果音とBGM |
| `js/config.js` | Supabase の接続先 |
| `supabase/schema.sql` | Supabase の表と権限 |
| `tools/fetch_cards.py` | 札の画像を取ってくるスクリプト |
| `tools/copy_function_lib.sh` | ルールのファイルをサーバー用にコピーする(Actions が使う) |

ルールのテストは `node tests/scoring.test.mjs` と `node tests/sim.test.mjs`、サーバーの処理のテストは `node tests/server.test.mjs` で動きます。

## セキュリティのしくみ

- 盤面を変えられるのはサーバーだけ。ブラウザからは「この札を出す」といった操作を送るだけで、サーバーが手番や手札を確かめてから盤面を進める
- 本当の盤面(両者の手札と山札)はサーバーの中だけにあり、誰も読めない。プレイヤーに届くのは自分の手札だけが見える盤面、観戦者に届くのは両方の手札を伏せた盤面
- サイコロと札の並びはサーバーが決める
- 戦績はサーバーが対局の結果から書く。ブラウザからは書けない
- ログインしていない人は部屋に入れない。部屋コードを10分に10回間違えると、しばらく入れなくなる
- 部屋コードはサーバーが予測できない乱数で作る。新しく部屋を作ると、前に作った相手待ちの部屋は閉じる
- ページで読み込んでよい場所を決めてあり(Content-Security-Policy)、決めた場所以外にはデータを送れない

`js/config.js` の publishable key はブラウザに置く前提の鍵なので、公開されていても問題ありません。Supabase の「Advisors」→「Security Advisor」で、警告が出ていないかときどき確かめると安心です。

## 札の画像について

札の画像は Wikimedia Commons の花札SVG(CC BY-SA 4.0)を使っています。作者とライセンスは `images/cards/credits.json` に保存され、アプリの「設定」→「札の画像について」にも表示されます。アイコンは札の絵を切り抜いて使っています。
