# Agent Kanban

Claude Code のタスクをカンバンボードで管理するデスクトップアプリ（Electron）です。タスクごとに **git worktree** を作り、複数のエージェントを **並列** に動かします。許可が必要な操作は **カード上でそのまま承認** できます。

![ボード画面：承認待ちのカードに許可・拒否ボタンが出ている](docs/board.png)

## 画面

### カード上で承認する
承認待ちのカードは黄色く光ります。実行しようとしているコマンドを確かめて、その場で「許可 / 拒否 / 常に許可」を押せます。

### 詳細パネル（承認待ち）
カードをクリックすると開きます。入力の全文を確かめたり、拒否の理由を書いて Claude に伝えたりできます。ログはリアルタイムに流れます。

![詳細パネル：承認待ちの内容とログ](docs/detail-permission.png)

### 詳細パネル（差分・マージ）
レビュー列のカードでは、ベースブランチからの差分を見てからマージできます。

![詳細パネル：差分タブとマージボタン](docs/detail-diff.png)

## できること

- **カードを作るとすぐに動き出す**: ブランチ `agent/<名前>-<id>` と worktree（`<リポジトリ>.worktrees/<id>`）を自動で作り、その中で `claude -p` を起動します
- **列は自動で移動**: Todo → 実行中（待機中を含む）→ レビュー（エラーを含む）→ 完了
- **カード上で承認**: 許可が必要な操作は、カードに「承認待ち」として表示されます。その場で **許可 / 拒否 / このタスクでは常に許可** を選べます。デスクトップ通知も出ます
- **詳細パネル**: カードをクリックすると開きます。中身は次のとおりです
  - ログ: Claude の発言、ツールの呼び出しと結果がリアルタイムに流れます
  - 差分: ベースブランチからの git diff
  - 指示: 最初の指示（開始前なら編集できます）
  - 追加指示: 同じセッションの続きとして動きます（`--resume`）
- **マージ / 破棄**: ボタン1つでベースブランチにマージ（`--no-ff`）するか、worktree とブランチをまとめて削除します
- **同時実行数の上限**: 上限を超えたカードは待機中になり、空きができると順番に起動します

## インストール

### コマンドでインストール（おすすめ）

**Mac / Linux**（ターミナルで実行）

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.sh | bash
```

- Mac: Apple Silicon か Intel かを見分けて、`/Applications` にインストールします。署名していないアプリで出る警告も、自動で出ないようにします
- Linux: `~/.local/bin/agent-kanban` に AppImage を置き、アプリのメニューにも登録します

**Windows**（PowerShell で実行）

```powershell
irm https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.ps1 | iex
```

最新のインストーラーをダウンロードして画面を出さずにインストールし、そのまま起動します。スタートメニューにも「Agent Kanban」が追加されます。

アップデートするときも、同じコマンドをもう一度実行するだけです。

<details>
<summary>バージョンを指定する・アンインストールする</summary>

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.sh | AGENT_KANBAN_VERSION=0.1.0 bash
```

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.sh | bash -s -- --uninstall
```

```powershell
$env:AGENT_KANBAN_VERSION = "0.1.0"; irm https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.ps1 | iex
```

Windows でアンインストールするときは、「設定 → アプリ」から「Agent Kanban」を削除します。

</details>

### ファイルをダウンロードしてインストール

[Releases](https://github.com/kazuya83/agent-kanban/releases) から、使っている OS のファイルをダウンロードします。

| OS | ファイル | 使い方 |
| --- | --- | --- |
| Windows | `agent-kanban-x.y.z-win-setup.exe` | インストーラー。ダブルクリックしてインストールします |
| Windows | `agent-kanban-x.y.z-win-portable.exe` | インストールせず、そのまま起動できます |
| Mac（Apple Silicon: M1〜） | `agent-kanban-x.y.z-mac-arm64.dmg` | 開いて、アプリを「アプリケーション」にドラッグします |
| Mac（Intel） | `agent-kanban-x.y.z-mac-x64.dmg` | 同上 |
| Linux | `agent-kanban-x.y.z-linux-x86_64.AppImage` | 実行権限を付けて起動します |

> **初めて起動するときの注意**
> 開発元の証明書で署名していないので、OS の警告が出ます。
> - **Mac**: 「開発元を検証できません」と出たら、アプリを右クリックして「開く」を選びます。それでも開けないときは、ターミナルで `xattr -cr "/Applications/Agent Kanban.app"` を実行してください
> - **Windows**: 「Windows によって PC が保護されました」と出たら、「詳細情報」→「実行」を押します

アプリとは別に、**git** と **Claude Code**（ログイン済み）が必要です。アプリは、ターミナルの PATH にある `claude` を自動で探します。見つからないときは、画面の上に案内が出ます（⚙ 設定でフルパスを指定することもできます）。

## ソースから動かす

### 必要なもの

- Node.js 20 以上
- git
- [Claude Code](https://docs.claude.com/en/docs/claude-code) をインストールし、ログインしておく（`claude` コマンドが使えれば OK）

### 起動

```bash
npm install
```

```bash
npm start
```

1. 「リポジトリを選ぶ」から、作業させたい git リポジトリを選びます（コミットが1つ以上必要です）
2. 「＋ 新しいタスク」から指示を書いて作成します
3. 承認待ちになったら、カードの「許可」を押します
4. レビュー列に移ったら、差分を確認して「マージ」か「破棄」を押します

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
- **main に push したとき**: 3つの OS でビルドし、Actions の実行結果ページの「Artifacts」から、できたファイルをダウンロードできます
- **`v` から始まるタグを push したとき**: ビルドして、[Releases](https://github.com/kazuya83/agent-kanban/releases) に添付します

```bash
git tag v0.1.0
```

```bash
git push origin v0.1.0
```

## 設定（⚙）

| 項目 | 説明 |
| --- | --- |
| ベースブランチ | worktree の作成元で、マージ先にもなるブランチ。空ならチェックアウト中のブランチ |
| 権限モード | `acceptEdits`（ファイル編集は自動、コマンドは承認）がおすすめ。`default` にすると、すべての操作をカードで承認します |
| 最初から許可しておくツール | `--allowedTools` に渡します。例: `Bash(npm test:*), WebSearch` |
| 同時に動かす数 | 1〜10 |
| モデル | `--model` に渡します。空なら既定のモデル |
| claude コマンドのパス | Finder などから起動して `claude` が見つからないときに、フルパスを指定します |

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

## 注意

- マージするときは、メインのリポジトリでベースブランチをチェックアウトし、未コミットの変更がない状態にしておいてください。コンフリクトしたらマージを中止して、そのことを知らせます
- アプリを終了すると、実行中のエージェントも止まります。次に起動したときはエラー列に入っているので、追加指示を送れば続きから再開できます

## 開発

```bash
npm test
```

テストでは、偽の claude（`test/fake-claude.js`）を使います。worktree の作成、承認（MCP 経由）、同時実行数の制限、追加指示、マージ、破棄、停止を通しで確かめます。
