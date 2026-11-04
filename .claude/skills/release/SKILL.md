---
name: release
description: Agent Kanban の新しい版を、この Mac でビルドして GitHub Release として公開する。テストと3つの OS のビルド → 落ちたら直す → 直したところを main にマージして push → できたファイルで Release を公開、までを scripts/after-merge-build.sh でその場で動かす。「リリースして」「新しい版を出して」「ビルドしてリリースして push して」「Release を出して」と頼まれたときに使う。
---

# /release — ビルドして、直して、push して、Release を出す

GitHub Actions ではビルド・リリースをしないので、手元の Mac から出す。
マージしたあとの自動の流れ（`.githooks/post-merge` → `scripts/after-merge-build.sh`）と同じことを、その場で動かす。

## 前提（足りなければユーザーに伝えて止まる）

- macOS。Apple Silicon では **Rosetta 2** が必要（無いときは、ユーザーに `softwareupdate --install-rosetta --agree-to-license` を実行してもらう）
- `gh` にログイン済みであること（`gh auth status`）
- `claude` が PATH にあること（中で `claude -p "/build-apps review"` を動かすため）

## 手順

1. `scripts/after-merge-build.sh --status` で、裏でもう動いていないかを確かめる
   - 「動いています」なら、二重に動かさない。今の段階をユーザーに伝え、終わってから `--status` で結果を見る（その実行でも Release まで出る）
2. main をチェックアウトしていて、コミットしていない変更がないことを確かめる（`git status --porcelain`）
   - 変更があれば、ユーザーにどうするか聞いて止まる
3. `git fetch origin main --tags` のあと、手元の main と origin/main を比べる
   - 手元のほうが進んでいる（push していないコミットがある）ときは、そのコミットの一覧を出し、次の手順の OK と一緒に push してよいかを聞く
   - origin/main のほうが進んでいる・分かれているときは、ユーザーに伝えて止まる
4. `scripts/release-local.sh --dry-run` で、次の版とリリースするかを確かめ、ユーザーに伝えて OK をもらう
   - 「リリースするものはありません」なら、そこで終わる（README・docs・テストだけの変更では出さない）
5. ユーザーが OK したら:
   1. 手元の main が進んでいれば `git push origin main`
   2. `scripts/after-merge-build.sh --force` を動かす（5〜10 分かかるので、Bash の `run_in_background` で動かし、終わるのを待つ）
      - 中で `claude -p "/build-apps review"` が動き、落ちたところ（install.sh / install.ps1 など）を直す。直したところがあればコミットして、もう一度ビルドし、main にマージして push する
      - ビルドが通ったら、できたファイルで `gh release create` する（もう一度ビルドはしない）
      - 段階ごとに macOS の通知が出る（1/4〜4/4・終わりました）
6. 終わったら `scripts/after-merge-build.sh --status` を見て報告する: 版の番号、直したところ（マージ・push したか）、公開した Release の URL（出さなかったときはその理由）
   - 失敗したとき（終了コードが 1）は、`--status` に出るいちばん新しいログの最後を見て、どこで落ちたかと、残したブランチ・worktree を伝える

## 注意

- 公開は外に出る操作なので、必ずユーザーの OK をもらってから 5 に進む
- バージョンは `scripts/next-version.js` が決める。0.2.0 のように大きく上げたいときは、package.json の version をその番号にして main に入れてから出す
- 直す流れがいらず、今の main をそのまま出すだけでよいときは、代わりに `scripts/release-local.sh` でもよい（もう一度ビルドしてから公開する）
- ビルドだけを確かめたいとき（公開しないとき）は `/build-apps review` を使う
