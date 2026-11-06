# README 用の画面とデモ GIF を撮る

実際のアプリを起動して、`docs/images/<言語>/` に画面（18枚）と `demo.gif` を作ります。言語は en / ja / es / fr / zh です。

画面に渡すデータは架空のものに差し替えます。`preload.js` のチャンネルをすべて差し替えるので、エージェントや GitHub などの外部サービスは動きません。

```bash
npm i --no-save playwright-core
# Electron の本体がないとき
node node_modules/electron/install.js

node scripts/capture/capture.js                         # 全部
node scripts/capture/capture.js --lang=en,ja            # 言語を選ぶ
node scripts/capture/capture.js --only=board,diff       # 画面を選ぶ（GIF は作らない）
node scripts/capture/capture.js --no-gif                # 画面だけ
node scripts/capture/capture.js --gif-only              # GIF だけ（ffmpeg が必要）
```

| ファイル | 中身 |
| --- | --- |
| `capture.js` | アプリの起動とデータの差し替え、撮影 |
| `content.js` | カードやログの文言（言語ごと） |
| `fixtures.js` | ボード・ログ・差分などの架空のデータ |
| `scenes.js` | 画面ごとの作り方 |
| `demo.js` | デモ GIF の流れ |

訳されていない日本語や古い名前が画面に残っていると、`!` で始まる行で知らせます。
