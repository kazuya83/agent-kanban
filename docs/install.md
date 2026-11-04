# インストール

## コマンドでインストール（おすすめ）

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

最新版をダウンロードして `%LOCALAPPDATA%\Programs\Agent Kanban` に入れ、スタートメニューとデスクトップにショートカットを作って起動します。管理者権限はいりません。

## アップデート（最新版にする）

インストールと同じコマンドで、[Releases](https://github.com/kazuya83/agent-kanban/releases) の最新版に入れ替わります。ボードやタスクのデータはそのまま残ります。前の名前（Claude Agent Kanban）で入れていた場合も、同じコマンドで Agent Kanban に入れ替わり、前の名前のアプリとショートカットは片付けます（データはそのまま使えます）。アプリを起動中なら、終了してから実行してください（Windows は自動で終了します）。

**Mac / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.sh | bash
```

**Windows**（PowerShell）

```powershell
irm https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.ps1 | iex
```

> 直後に古い版が入るときは、GitHub 側のキャッシュ（最大5分）が残っています。少し待ってからもう一度実行してください。

<details>
<summary>バージョンを指定する・アンインストールする</summary>

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.sh | AGENT_KANBAN_VERSION=0.1.1 bash
```

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.sh | bash -s -- --uninstall
```

```powershell
$env:AGENT_KANBAN_VERSION = "0.1.1"; irm https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.ps1 | iex
```

```powershell
$env:AGENT_KANBAN_UNINSTALL = "1"; irm https://raw.githubusercontent.com/kazuya83/agent-kanban/main/install.ps1 | iex
```

（setup.exe で入れた場合は、「設定 → アプリ」から「Agent Kanban」（前の名前のころに入れたものは「Claude Agent Kanban」）を削除します。）

</details>

## ファイルをダウンロードしてインストール

[Releases](https://github.com/kazuya83/agent-kanban/releases) から、使っている OS のファイルをダウンロードします。

| OS | ファイル | 使い方 |
| --- | --- | --- |
| Windows | `agent-kanban-x.y.z-win-setup.exe` | インストーラー。ダブルクリックしてインストールします |
| Windows | `agent-kanban-x.y.z-win-portable.exe` | インストールせず、そのまま起動できます |
| Windows | `agent-kanban-x.y.z-win-x64.zip` | 展開して、中の `Agent Kanban.exe` を起動します |
| Mac（Apple Silicon: M1〜） | `agent-kanban-x.y.z-mac-arm64.dmg` | 開いて、アプリを「アプリケーション」にドラッグします |
| Mac（Intel） | `agent-kanban-x.y.z-mac-x64.dmg` | 同上 |
| Linux | `agent-kanban-x.y.z-linux-x86_64.AppImage` | 実行権限を付けて起動します |

> **初めて起動するときの注意**
> 開発元の証明書で署名していないので、OS の警告が出ます。
> - **Mac**: 「開発元を検証できません」と出たら、アプリを右クリックして「開く」を選びます。それでも開けないときは、ターミナルで `xattr -cr "/Applications/Agent Kanban.app"` を実行してください
> - **Windows**: 「Windows によって PC が保護されました」と出たら、「詳細情報」→「実行」を押します

アプリとは別に、**git** と、使うエージェントの CLI（**Claude Code / Codex CLI / Gemini CLI / Cursor CLI** のどれか。ログイン済み）が必要です。アプリは、ターミナルの PATH にある `claude` / `codex` / `gemini` / `cursor-agent` を自動で探します。見つからないときは、画面の上に案内が出ます（⚙ 設定でフルパスを指定することもできます）。

## Windows で WSL（Ubuntu など）のリポジトリを使う

Windows では、「リポジトリを選ぶ」を押すと、**このパソコンのフォルダ** か **WSL（Ubuntu など）のフォルダ** かを選べます。

- 「Ubuntu のフォルダを選ぶ」を押すと、エクスプローラーの画面が Ubuntu のホームフォルダ（`\\wsl.localhost\Ubuntu\home\…`）から開きます。エクスプローラーの左の「Linux」から Ubuntu のフォルダを選んでも、同じように扱います
- WSL のリポジトリでは、**git と claude を WSL の中で動かします**（worktree も WSL の中に作ります）。Windows 側の git や claude で WSL のファイルを扱うと、遅いうえに git の所有者チェックで止まり、エージェントが `npm install` などをすると Windows 用のものが入ってしまうためです
- そのため、**WSL の中にも git と Claude Code（ログイン済み）が必要です**。足りないときは、画面の上に案内が出ます

  ```bash
  sudo apt install git
  ```

  Claude Code は、WSL のターミナルで公式の手順に沿ってインストールし、`claude` を一度起動してログインしておいてください
- カードの承認やエージェントからの質問は、WSL の中の claude から Windows 側のアプリに届きます（アプリの画面は Windows で動いたままです）
- 会話の一覧とスキルは、WSL の中の `~/.claude` から読みます
- 「フォルダを開く」は、エクスプローラーで WSL のフォルダを開きます

---

[← README に戻る](../README.md)
