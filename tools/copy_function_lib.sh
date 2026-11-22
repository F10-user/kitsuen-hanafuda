#!/bin/sh
# Edge Function「game」が使うルールのファイルを js/ からコピーする。
# ブラウザ用に付けている ?v=版番号 は外す。デプロイの前に GitHub Actions が動かす。
set -e
cd "$(dirname "$0")/.."
dest=supabase/functions/game/lib
mkdir -p "$dest"
for f in cards scoring engine serverlogic; do
  sed -E "s/(\.\/[A-Za-z0-9_-]+\.js)\?v=[A-Za-z0-9_-]+/\1/g" "js/$f.js" > "$dest/$f.js"
done
echo "copied to $dest"
