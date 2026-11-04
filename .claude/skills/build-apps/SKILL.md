---
name: build-apps
description: Agent Kanban のテストと、Mac（dmg）・Windows（exe / zip）・Linux（AppImage）のビルドをこの Mac で行う。レビューのとき（「ビルドして」「3つの OS でビルドできるか確かめて」「install.sh / install.ps1 を直した」）や、main にマージしたあとリリースするとき（「リリースして」「新しい版を出して」）に使う。GitHub Actions ではビルド・リリースをしないので、これがその代わり。
argument-hint: '[review | release]'
---

# /build-apps — テスト・3つの OS のビルド・リリース

GitHub Actions はテストだけを動かす。**ビルドとリリースは、このスキルで手元の Mac から行う。**
画面の確認・インストールの確認はしない（テストとビルドが通れば OK）。

引数がなければ、今のブランチで決める: main 以外（タスクの worktree など）なら `review`、main なら `release`。

## 前提（足りなければユーザーに伝えて止まる）

- macOS。Apple Silicon では **Rosetta 2** が必要（Windows のインストーラーと AppImage を作る道具が Intel 用のため）
  - 無いときは、ユーザーに `softwareupdate --install-rosetta --agree-to-license` を実行してもらう（管理者のパスワードを聞かれることがある）
- `release` では `gh` にログイン済みであること（`gh auth status`）

## review（レビューのとき）

1. `scripts/build-all.sh` を実行する（node_modules が無ければ `npm ci` から始まる。5〜10 分かかる）
   - テスト（`npm test`）→ install.sh / install.ps1 の書き方の確認 → 3つの OS のビルド → できたファイルの確認、の順に進む
2. 失敗したら、出力からどの段階で落ちたかを確かめて直し、もう一度実行する
   - install.sh / install.ps1 を直したときは、書き方の確認（`bash -n`、pwsh があれば構文解析）が通ることを確かめる
3. 結果を短く報告する: テストの件数、できたファイル（`dist/`）の一覧、直したところ
4. コミット・マージ・公開はしない

## release（main にマージしたあと）

1. `scripts/release-local.sh --dry-run` で、次の版とリリースするかを確かめ、ユーザーに伝える
   - 「リリースするものはありません」なら、そこで終わる（README・docs・テストだけの変更では出さない）
2. ユーザーが OK したら `scripts/release-local.sh` を実行する
   - main が origin/main と同じで、変更が残っていないことを確かめてから、ビルドして `gh release create` で公開する
3. 公開した Release の URL と、付けたファイルを報告する

## 注意

- 公開は外に出る操作なので、手で `release` するときは必ずユーザーの OK をもらってから行う
- バージョンは `scripts/next-version.js` が決める。0.2.0 のように大きく上げたいときは、package.json の version をその番号にして main に入れてから release する
- `dist/` は毎回消して作り直す
- main にタスクをマージすると、`.githooks/post-merge` → `scripts/after-merge-build.sh` が、このスキルの `review` を `claude -p` で裏で動かす（`build-apps/<sha>` という worktree の中で動く）。そのときはユーザーに質問できないので、最後まで自分で直す。コミット・マージ・push・Release の公開はスクリプトが行うので、スキルの中ではしない。できたファイルは、スクリプトが main をチェックアウトしているフォルダの `dist/` に写し、ビルドが通ればそのファイルで Release を公開する（ユーザーがこの自動の公開を有効にしている。止めるときは `AFTER_MERGE_NO_RELEASE=1`）
