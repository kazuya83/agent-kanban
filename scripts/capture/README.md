# README 用の画面と GIF を撮る

実際のアプリを起動して、`docs/images/<言語>/` に画面（18枚）、`demo.gif`、機能ごとの GIF（`feature-<名前>.gif`、12本）を作ります。言語は en / ja / es / fr / zh です。

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
node scripts/capture/capture.js --feature=pipeline,issue # 機能ごとの GIF を選ぶ（画面とデモ GIF は作らない）
```

| ファイル | 中身 |
| --- | --- |
| `capture.js` | アプリの起動とデータの差し替え、撮影 |
| `content.js` | カードやログの文言（言語ごと） |
| `fixtures.js` | ボード・ログ・差分などの架空のデータ |
| `scenes.js` | 画面ごとの作り方 |
| `demo.js` | デモ GIF の流れ |
| `features.js` | 機能ごとの GIF の流れ（pipeline / subtasks / repos / approval / question / issue / merge / remote / chat / notifications / conflict / skills） |
| `feature-content.js` | 機能ごとの GIF で使う文言（言語ごと） |
| `recorder.js` | GIF の録画（マウスの矢印、コマの撮影、ffmpeg でつなぐ） |

訳されていない日本語や古い名前が画面に残っていると、`!` で始まる行で知らせます。
