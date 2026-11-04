---
name: build-apps
description: Agent Kanban のテストと、Mac（dmg）・Windows（exe / zip）・Linux（AppImage）のビルドをこの Mac で行う。レビューのとき（「ビルドして」「3つの OS でビルドできるか確かめて」「install.sh / install.ps1 を直した」）や、main にマージしたあとリリースするとき（「リリースして」「新しい版を出して」「ビルドしてリリースして push して」）に使う。GitHub Actions ではビルド・リリースをしないので、これがその代わり。
argument-hint: '[review | release]'
---

# /build-apps — テスト・3つの OS のビルド・リリース

GitHub Actions はテストだけを動かす。**ビルドとリリースは、このスキルで手元の Mac から行う。**
画面の確認・インストールの確認はしない（テストとビルドが通れば OK）。

引数がなければ、今のブランチで決める: main 以外（タスクの worktree など）なら `review`、main なら `release`。

## 前提（足りなければユーザーに伝えて止まる）

- macOS。Apple Silicon では **Rosetta 2** が必要（Windows のインストーラーと AppImage を作る道具が Intel 用のため）
  - 無いときは、ユーザーに `softwareupdate --install-rosetta --agree-to-license` を実行してもらう（管理者のパスワードを聞かれることがある）
- `release` では `gh` にログイン済みであること（`gh auth status`）と、`claude` が PATH にあること（中で `claude -p` を動かすため）

## review（レビューのとき）

1. `scripts/build-all.sh` を実行する（node_modules が無ければ `npm ci` から始まる。5〜10 分かかる）
   - テスト（`npm test`）→ install.sh / install.ps1 の書き方の確認 → 3つの OS のビルド → できたファイルの確認、の順に進む
2. 失敗したら、出力からどの段階で落ちたかを確かめて直し、もう一度実行する
   - install.sh / install.ps1 を直したときは、書き方の確認（`bash -n`、pwsh があれば構文解析）が通ることを確かめる
3. 結果を短く報告する: テストの件数、できたファイル（`dist/`）の一覧、直したところ
4. コミット・マージ・公開はしない

## release（main にマージしたあと）

マージしたあとの自動の流れ（`scripts/after-merge-build.sh`）を、その場で動かす: テストと3つの OS のビルド → 落ちたら直す → 直したところを main にマージして push → できたファイルで GitHub Release を公開。

1. `scripts/after-merge-build.sh --status` で、裏でもう動いていないかを確かめる
   - 「動いています」なら、二重に動かさない。今の段階をユーザーに伝え、終わってから `--status` で結果を見る（その実行でも Release まで出る）
2. main をチェックアウトしていて、コミットしていない変更がないことを確かめる（`git status --porcelain`）
   - 変更があれば、ユーザーにどうするか聞いて止まる
3. `git fetch origin main --tags` のあと、手元の main と origin/main を比べる
   - 手元のほうが進んでいる（push していないコミットがある）ときは、そのコミットの一覧を出し、次の手順の OK と一緒に push してよいかを聞く
   - origin/main のほうが進んでいる・分かれているときは、ユーザーに伝えて止まる
4. `scripts/release-local.sh --dry-run` で、次の版とリリースするかを確かめ、ユーザーに伝える
   - 「リリースするものはありません」なら、そこで終わる（README・docs・テストだけの変更では出さない）
5. ユーザーが OK したら:
   1. 手元の main が進んでいれば `git push origin main`
   2. `scripts/after-merge-build.sh --force` を動かす（5〜10 分かかるので、Bash の `run_in_background` で動かし、終わるのを待つ）
      - 中で `claude -p "/build-apps review"` が動き、落ちたところを直す。直したところがあればコミットして、もう一度ビルドし、main にマージして push する
      - 段階ごとに macOS の通知が出る（1/4〜4/4・終わりました）
6. 終わったら `scripts/after-merge-build.sh --status` を見て報告する: 版の番号、直したところ（マージ・push したか）、公開した Release の URL（出さなかったときはその理由）
   - 失敗したとき（終了コードが 1）は、`--status` に出るいちばん新しいログの最後を見て、どこで落ちたかと、残したブランチ・worktree を伝える
   - 直す流れがいらず、今の main をそのまま出すだけでよいときは、代わりに `scripts/release-local.sh` でもよい（もう一度ビルドしてから公開する）

## 注意

- 公開は外に出る操作なので、手で `release` するときは必ずユーザーの OK をもらってから行う
- バージョンは `scripts/next-version.js` が決める。0.2.0 のように大きく上げたいときは、package.json の version をその番号にして main に入れてから release する
- `dist/` は毎回消して作り直す
- main にタスクをマージすると、`.githooks/post-merge` → `scripts/after-merge-build.sh` が、このスキルの `review` を `claude -p` で裏で動かす（`build-apps/<sha>` という worktree の中で動く）。そのときはユーザーに質問できないので、最後まで自分で直す。コミット・マージ・push・Release の公開はスクリプトが行うので、スキルの中ではしない。できたファイルは、スクリプトが main をチェックアウトしているフォルダの `dist/` に写し、ビルドが通ればそのファイルで Release を公開する（ユーザーがこの自動の公開を有効にしている。止めるときは `AFTER_MERGE_NO_RELEASE=1`）
