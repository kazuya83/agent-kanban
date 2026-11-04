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
- 0.2.0 のように大きく上げたいときは、`package.json` の `version` をその番号にして main に入れてから実行します
- `--dry-run` を付けると、次の版とリリースするかどうかだけを出します

インストール用のコマンドは、いつも最新の Release を入れます。

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

---

[← README に戻る](../README.md)
