[English](install.md) · [日本語](install.ja.md)

# インストール

## コマンドでインストール（おすすめ）

**Mac / Linux**（ターミナルで実行）

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.sh | bash
```

- Mac: Apple Silicon か Intel かを見分けて、`/Applications` にインストールします。署名していないアプリで出る警告も、自動で出ないようにします
- Linux: `~/.local/bin/worktree-kanban` に AppImage を置き、アプリのメニューにも登録します（前の名前の `agent-kanban` でも起動できます）

**Windows**（PowerShell で実行）

```powershell
irm https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.ps1 | iex
```

最新版をダウンロードして `%LOCALAPPDATA%\Programs\Worktree Kanban` に入れ、スタートメニューとデスクトップにショートカットを作って起動します。管理者権限はいりません。

## アップデート（最新版にする）

インストールと同じコマンドで、[Releases](https://github.com/kazuya83/worktree-kanban/releases) の最新版に入れ替わります。ボードやタスクのデータはそのまま残ります。前の名前（Agent Kanban・Claude Agent Kanban）で入れていた場合も、同じコマンドで Worktree Kanban に入れ替わり、前の名前のアプリとショートカットは片付けます（データはそのまま使えます）。アプリを起動中なら、終了してから実行してください（Windows は自動で終了します）。

**アプリから更新する**: メニューの設定の「アプリの更新」に、今の版と新しい版があるかが出ます（起動したときと6時間ごとに確かめます。新しい版があれば、左上の版の横にも出ます。押すと、設定の「アプリの更新」が開きます）。「新しいバージョンに更新」を押すと、アプリを終了して下のコマンドと同じ方法で新しい版に入れ替え、起動し直します。実行中のタスクは中断し、それまでの変更はブランチにコミットするので、起動し直したあとに「再開」で続けられます。

- 「新しい版が出たら自動で更新する」にチェックを付けると、新しい版を見つけたときに、実行中・待機中のタスクがなくなるのを待ってから自動で入れ替えます（初期値はオフ。別の PC から操作している間は入れ替えません）
- 入れる場所は、下のコマンドで入れたときと同じです（Mac は /Applications か ~/Applications、Linux は ~/.local/bin、Windows は %LOCALAPPDATA%\Programs\Worktree Kanban）。Linux は AppImage で起動したときだけ使えます。開発版（`npm start`）では使えません
- 入れられなかったときは元の版を起動し直し、次の起動で知らせます。記録は「アプリの更新」の「更新の記録を開く」（userData フォルダの update.log）で見られます

**Mac / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.sh | bash
```

**Windows**（PowerShell）

```powershell
irm https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.ps1 | iex
```

> 直後に古い版が入るときは、GitHub 側のキャッシュ（最大5分）が残っています。少し待ってからもう一度実行してください。

<details>
<summary>バージョンを指定する・アンインストールする</summary>

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.sh | WORKTREE_KANBAN_VERSION=0.1.1 bash
```

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.sh | bash -s -- --uninstall
```

```powershell
$env:WORKTREE_KANBAN_VERSION = "0.1.1"; irm https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.ps1 | iex
```

```powershell
$env:WORKTREE_KANBAN_UNINSTALL = "1"; irm https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.ps1 | iex
```

（setup.exe で入れた場合は、「設定 → アプリ」から「Worktree Kanban」（前の名前のころに入れたものは「Agent Kanban」「Claude Agent Kanban」）を削除します。）

</details>

## ファイルをダウンロードしてインストール

[Releases](https://github.com/kazuya83/worktree-kanban/releases) から、使っている OS のファイルをダウンロードします。

| OS | ファイル | 使い方 |
| --- | --- | --- |
| Windows | `worktree-kanban-x.y.z-win-setup.exe` | インストーラー。ダブルクリックしてインストールします |
| Windows | `worktree-kanban-x.y.z-win-portable.exe` | インストールせず、そのまま起動できます |
| Windows | `worktree-kanban-x.y.z-win-x64.zip` | 展開して、中の `Worktree Kanban.exe` を起動します |
| Mac（Apple Silicon: M1〜） | `worktree-kanban-x.y.z-mac-arm64.dmg` | 開いて、アプリを「アプリケーション」にドラッグします |
| Mac（Intel） | `worktree-kanban-x.y.z-mac-x64.dmg` | 同上 |
| Linux | `worktree-kanban-x.y.z-linux-x86_64.AppImage` | 実行権限を付けて起動します |

> **初めて起動するときの注意**
> 開発元の証明書で署名していないので、OS の警告が出ます。
> - **Mac**: 「開発元を検証できません」と出たら、アプリを右クリックして「開く」を選びます。それでも開けないときは、ターミナルで `xattr -cr "/Applications/Worktree Kanban.app"` を実行してください
> - **Windows**: 「Windows によって PC が保護されました」と出たら、「詳細情報」→「実行」を押します

アプリとは別に、**git** と、使うエージェントの CLI（**Claude Code / Codex CLI / Antigravity CLI / Gemini CLI / Cursor CLI** のどれか。ログイン済み）が必要です。アプリは、ターミナルの PATH にある `claude` / `codex` / `agy` / `gemini` / `cursor-agent` を自動で探します。見つからないときは、画面の上に案内が出ます（メニューの設定の「使うエージェント」でフルパスを指定することもできます）。

Antigravity CLI は `curl -fsSL https://antigravity.google/cli/install.sh | bash` で入れて、一度 `agy` を起動してログインしておきます。Gemini CLI は、個人のアカウントでは使えなくなりました（[詳しくは](agents.ja.md)）。

## Windows で WSL（Ubuntu など）のリポジトリを使う

Windows では、「リポジトリを選ぶ」を押すと、**このパソコンのフォルダ** か **WSL（Ubuntu など）のフォルダ** かを選べます。

- 「Ubuntu のフォルダを開く」を押すと、エクスプローラーの画面が Ubuntu のホームフォルダ（`\\wsl.localhost\Ubuntu\home\…`）から開きます。エクスプローラーの左の「Linux」から Ubuntu のフォルダを選んでも、同じように扱います
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

[← README に戻る](../README.ja.md)
