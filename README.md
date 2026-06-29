# iPad ゲーム集（ぷよぷよ・テトリス）

iPad（スマホ・PCも対応）のブラウザで遊べる、タッチ操作対応ゲーム集です。
HTML / CSS / JavaScript だけの静的サイトなので、ビルド不要でそのまま動きます。

トップページからゲームを選べます。

- `/` … ゲーム選択トップ
- `/puyo` … ぷよぷよ
- `/tetris` … テトリス

## ローカルでの起動

```bash
npm run dev
```

`http://localhost:3000` などで開けます（静的ファイルを配信するだけ）。

## Vercel へのデプロイ

このリポジトリは静的サイトなので、Vercel にそのままデプロイできます。
**1回のインポートで両方のゲームが別URLで公開されます。**

1. [Vercel](https://vercel.com/) にこのリポジトリをインポート（フレームワークは Other のままでOK、ビルド設定不要）
2. このリポジトリは複数ブランチがあり、両ゲームは **`claude/puyo-puyo-ipad-vercel-0hkzmg`** ブランチに揃っています。
   - Vercel が別ブランチ（テトリスのみ等）をデプロイしてしまう場合は、
     **Project Settings → Git → Production Branch** を `claude/puyo-puyo-ipad-vercel-0hkzmg` に変更してください。
3. デプロイ後の URL を iPad の Safari で開くと、トップからゲームを選べます。
   - 例: `https://<your-app>.vercel.app/`（トップ） / `…/puyo` / `…/tetris`

ホーム画面に追加すると、全画面のアプリのように楽しめます。

### CLI でのデプロイ

```bash
npx vercel        # プレビューデプロイ
npx vercel --prod # 本番デプロイ
```

## ファイル構成

```
index.html        ゲーム選択トップ
puyo/             ぷよぷよ（index.html / style.css / game.js）
tetris/           テトリス（index.html / style.css / game.js）
vercel.json       Vercel 設定
```

## 遊び方（共通の操作感）

- 画面下のボタン、または盤面のスワイプ / タップで操作します。
- PC ではキーボードでも操作できます（矢印キーなど）。

### ぷよぷよ
同じ色のぷよを 4つ以上つなげると消えます。連鎖で高得点を狙いましょう。

### テトリス
落ちてくるブロックを並べ、横一列をそろえて消します。
