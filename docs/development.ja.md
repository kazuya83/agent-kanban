[English](development.md) · [日本語](development.ja.md)

# 開発者向け（ソースから動かす・ビルド・しくみ）

## ソースから動かす

### 必要なもの

- Node.js 22 以上（24 推奨）
- git
- 使うエージェントの CLI をインストールし、ログインしておく（[Claude Code](https://docs.claude.com/en/docs/claude-code) の `claude`、Codex CLI の `codex`、Gemini CLI の `gemini`、[Cursor CLI](https://cursor.com/cli) の `cursor-agent` のどれか）

### 起動

```bash
npm install
```

```bash
npm start
```

1. 「リポジトリを選ぶ」から、作業させたい git リポジトリを選びます（コミットが1つ以上必要です）
   - 手元にまだないときは、同じ画面の **URL からクローンする**（`https://github.com/owner/repo`・`git@github.com:owner/repo.git`・`owner/repo`）か **新しく作る**（README.md だけの最初のコミットまで作ります。gh にログインしていれば GitHub にも作って push できます）を選べます
2. 「＋ 新しいタスク」から指示を書いて作成します
3. 承認待ちになったら、カードの「許可」を押します
4. レビュー列に移ったら、差分を確認して「マージ」（マージ先のブランチを選びます）か「破棄」を押します

### アプリをビルドする

```bash
npm run dist:mac
```

```bash
npm run dist:win
```

```bash
npm run dist:linux
```

`dist/` に出力されます。

### 3つの OS をまとめてビルドする・リリースする（Mac で）

GitHub Actions はテストだけを動かします（`.github/workflows/build.yml`）。**ビルドとリリースは手元の Mac で行います。** Claude Code では `/build-apps` スキルで同じことができます。

```bash
scripts/build-all.sh
```

テスト → install.sh / install.ps1 の書き方の確認 → Mac（dmg）・Windows（exe / zip）・Linux（AppImage）のビルドをまとめて行います（レビューのとき）。Apple Silicon の Mac では **Rosetta 2** が必要です（Windows のインストーラーと AppImage を作る道具が Intel 用のため）。

```bash
softwareupdate --install-rosetta --agree-to-license
```

main にマージしたら、次でリリースします。

```bash
scripts/release-local.sh
```

- 最新のリリースからアプリの中身が変わっていれば、版の番号を1つ上げて（例: v0.1.8 → v0.1.9）ビルドし、GitHub Release を作ります。`package.json` を書き換える必要はありません
- README・docs やテストだけの変更では、リリースしません
- Release の説明は `scripts/release-notes.js` が、前の版からのコミットを「新機能・改善」「不具合の修正」「ドキュメント」「開発・ビルドまわり」に分けて Markdown でまとめます（OS ごとのダウンロードの表と、比較のリンクも付けます）。`/release`（マージ後の自動ビルド）でも同じ説明になります
- 0.2.0 のように大きく上げたいときは、`package.json` の `version` をその番号にして main に入れてから実行します
- `--dry-run` を付けると、次の版とリリースするかどうかだけを出します

インストール用のコマンドは、いつも最新の Release を入れます。

### マージしたあとに自動でビルドする

次を1回実行しておきます。そうすると、Worktree Kanban でタスクを main にマージするたびに（マージのメッセージが `Merge agent task:` で始まるとき）、`/build-apps` が裏で動きます。

```bash
git config core.hooksPath .githooks
```

- `.githooks/post-merge` が `scripts/after-merge-build.sh` を裏で走らせます。マージ自体はすぐに終わります
- マージしたあとの main から一時的な worktree（ブランチ `build-apps/<sha>`）を作り、エージェントに `/build-apps review` を頼んで、テストと3つの OS のビルドをします。落ちたときは、install.sh / install.ps1 などをエージェントが直します。エージェントは `claude` → `codex` → `gemini` → `cursor-agent` の順に、見つかったものを使います（`AFTER_MERGE_AGENT` で選べます。Claude Code 以外は権限の確認なしで動かします）
- できたファイルは、main をチェックアウトしているフォルダの `dist/` に写して残します
- 直したところがあれば、コミットしてからもう一度ビルドして確かめます。通れば main にマージして `origin/main` に push します。直したところがなければ、マージも push もしません
- **ビルドが通ったら、そのまま GitHub Release を公開します。** できたファイルをそのまま使うので、もう一度ビルドはしません。版の番号とリリースするかどうかは `scripts/release-local.sh` と同じく `scripts/next-version.js` で決めます（README・docs・テストだけの変更では出しません）
  - ビルドしたコミットがまだ `origin/main` にない（push していない）とき・その版がもう公開されているときは、出しません
  - 出したくないときは `AFTER_MERGE_NO_RELEASE=1` を付けます。`gh` にログインしておく必要があります
- 失敗したとき・コンフリクトしたとき・main に未コミットの変更があるときは、自動ではマージも公開もしません。macOS の通知で知らせ、ブランチと worktree を残します
- 一度に1つだけ動きます。動いている間に次のマージが入ったら、終わったあとにもう一度動きます
- **進み具合**: 「1/4 テストとビルドを始めました」→「2/4 直したところがあったので、もう一度ビルドしています」（直したときだけ）→「3/4 ビルド OK」→「4/4 Release を出すか確かめています」→「終わりました: …（公開した Release の URL か、出さなかった理由）」の順に、macOS の通知で知らせます
  - `scripts/after-merge-build.sh --status` で、動いているかどうか・今の段階・これまでの結果（新しい 10 件）を見られます（中身は `.git/build-apps/status` と `.git/build-apps/history.log`）
- 細かいログは `.git/build-apps/logs/` に出ます。手で動かすときは `scripts/after-merge-build.sh` を実行します（同じ main で前に動かしたことがあっても動かすときは `--force`）
- Claude Code で `/release`（または `/build-apps release`）と頼むと、確認したうえでこの流れ（ビルド → 直す → マージ・push → Release）をその場で動かします
- 止めたいときは `git config --unset core.hooksPath` を実行します

## しくみ

```
Electron メインプロセス
 ├─ AgentManager … カードごとに git worktree を作り、claude -p --output-format stream-json を起動
 │                  stdout の JSON を読んで、ログ・状態・コストを更新
 └─ PermissionServer（127.0.0.1・トークン付き HTTP）
        ▲
        │ 承認を問い合わせる（ユーザーが押すまで待つ）
 permission-mcp.js（stdio の MCP サーバー）
        ▲
        │ --permission-prompt-tool mcp__agent_kanban__approve
 claude（各 worktree の中で動く）
```

- 承認は Claude Code の `--permission-prompt-tool` で受けています。権限モードや `--allowedTools` で自動的に許可されない操作だけが、アプリに問い合わされます
- 承認を待つ間にタイムアウトしないよう、`MCP_TOOL_TIMEOUT` を長くしてあります
- エージェントが終わると、worktree の変更は自動でそのブランチにコミットされます
- ボードのデータは Electron の userData フォルダの `board.json` に保存されます

## 開発

```bash
npm test
```

テストでは、偽の claude（`test/fake-claude.js`）を使います。worktree の作成、承認（MCP 経由）、同時実行数の制限、追加指示、マージ、破棄、停止を通しで確かめます。

## 名前を変えたときに残しているもの

Agent Kanban から Worktree Kanban へ改名しても、今のユーザーがそのまま使えるように、次は前の名前のままにしています。

- データの場所（userData の `agent-kanban` フォルダ。`main.js` で固定）、SSH の鍵（`agent-kanban_ed25519`）、Pipeline のファイル形式、appId
- Release の前の名前のファイル（`agent-kanban-<版>-…`）。改名前の版は、このファイルがないと自分を更新できません（`scripts/legacy-assets.sh`）
- インストーラの `AGENT_KANBAN_VERSION` の指定と、Linux の `~/.local/bin/agent-kanban`（改名前の版が更新のあとに起動するため）

画面の画像とデモ GIF の撮り直しは [scripts/capture/README.md](../scripts/capture/README.md) を見てください。

---

[← README に戻る](../README.ja.md)
