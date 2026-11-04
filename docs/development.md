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

`dist/` に出力されます。Mac 用は macOS 上で、Windows 用は Windows 上でビルドしてください（Linux から Windows 用をビルドするには Wine が必要です）。

GitHub Actions でも自動でビルドします（`.github/workflows/build.yml`）。
- **push したとき**: まずテストを動かします
- **main に push したとき**: 最新のリリースからアプリの中身が変わっていれば、**自動で新しい版をリリースします**
  - バージョンは自動で上がります（例: v0.1.8 → v0.1.9）。`package.json` を書き換える必要はありません
  - テストが通ったら、すぐにビルドしてリリースします。途中で次の push が来たら前の分は取り消すので、続けてマージしても、リリースまで進むのは最後の1回です
  - README・docs やテストだけの変更では、リリースしません
  - 0.2.0 のように大きく上げたいときは、`package.json` の `version` をその番号にして push します
  - リリースしたあと、Mac・Windows・Linux でインストール用のコマンドを実際に試します
- **手動で実行したとき**（Actions の「Run workflow」）: すぐに3つの OS でビルドして、実行結果ページの「Artifacts」にファイルを置きます（リリースはしません）

### Mac のビルドが「Queued」のまま進まないとき

GitHub の Mac の実行環境が混んでいると、ジョブが割り当てを待ったまま進みません（ビルドの不具合ではありません）。待っているあいだに次の push をすると、その実行は取り消されて、新しい実行がまた最初から待つことになります。

Mac の実行環境の種類は、**リポジトリの変数 `MACOS_RUNNER`** で変えられます（コードを変える必要はありません）。何も入れなければ `macos-14` を使います。

1. GitHub のリポジトリの「Settings → Secrets and variables → Actions → **Variables**」を開きます
2. 「New repository variable」で、名前を `MACOS_RUNNER`、値を使いたい実行環境（例: `macos-14`、`macos-15`、`macos-latest`、Intel の `macos-15-intel`）にして保存します
3. 次の push から、その実行環境でビルドとインストールの確認をします

Intel の Mac の実行環境でも、Apple Silicon 用（arm64）と Intel 用（x64）の両方の dmg を作れます。

新しいバージョンは、main に push すると自動で出ます。インストール用のコマンドは、いつも最新の Release を入れます。

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
