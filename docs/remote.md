# 遠隔操作（SSH トンネルで別の PC からボードを操作する）

エージェントを動かす PC（**ホスト**）のボードを、別の PC（**クライアント**）の Agent Kanban から、**ほぼそのまま表示・操作**できます。

- ホストもクライアントも、**Mac でも Windows でも** かまいません（Windows → Mac、Windows → Windows、Mac → Windows、Mac → Mac のどれでもつなげます）。どのマシンもホストにもクライアントにもなれます
- ホストのアプリは `127.0.0.1` だけで待ち受けるので、インターネットへ直接は出ません。**SSH のポート転送**を通してつなぎます（クライアントのアプリが `ssh` を起動してトンネルを張ります）
- 外出先からつなぐときは、両方の PC に [Tailscale](https://tailscale.com/) を入れます。ルーターの設定は要りません

> Tailscale の IP（`100.x.x.x`）を「接続先ホスト」に入れて直接つなぐと、`connect ETIMEDOUT` になります。ホストが `127.0.0.1` でしか待ち受けていないためです。接続方法を **「SSH 経由」** にして、Tailscale の IP は **SSH の接続先** に入れてください。

## 全体の流れ

| | ホスト（作業する PC） | クライアント（操作する PC） |
| --- | --- | --- |
| 1 | Tailscale を入れてログイン | Tailscale を入れて同じアカウントでログイン |
| 2 | SSH サーバーをオンにする | Agent Kanban の「RC設定」で **鍵を作る** |
| 3 | 受け取った公開鍵を「RC設定」で選んで登録する | パスワードなしで `ssh` で入れるか確かめる |
| 4 | Agent Kanban で「ホストを開始」 | Agent Kanban で「SSH 経由」で接続 |

1〜3 は最初の1回だけです。

## 1. Tailscale を入れる（両方の PC）

1. 両方の PC に [Tailscale](https://tailscale.com/download) を入れて、**同じアカウント** でログインします
2. どちらの PC でも、Tailscale が **接続中（Connected）** になっているのを確かめます。ホストの IP（`100.x.x.x`）とマシン名は、Tailscale のメニューか [管理画面](https://login.tailscale.com/admin/machines) に出ます
3. クライアントのターミナルで次を実行して、返事が来ればつながっています

   ```bash
   tailscale ping <ホストの Tailscale の IP>
   ```

   （Mac で `tailscale` が見つからないときは `/Applications/Tailscale.app/Contents/MacOS/Tailscale ping <IP>`）

> 管理画面で相手が **offline** になっていると、SSH は必ずタイムアウトします。Windows はログオフ・スリープ中や、Tailscale を終了していると offline になります。

同じ LAN の中だけで使うなら、Tailscale の代わりにホストの LAN の IP（`192.168.x.x` など）でもかまいません。

## 2. ホストの SSH サーバーをオンにする

### ホストが Mac のとき

「システム設定 → 一般 → 共有 → **リモートログイン**」をオンにします（「i」から、入れるユーザーを選べます）。

### ホストが Windows のとき

管理者の PowerShell で、OpenSSH サーバーを入れて起動し、ログオン時に自動で起動するようにします（「設定 → システム → オプション機能 → 機能を表示」から「OpenSSH サーバー」を追加してもかまいません）。

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service sshd -StartupType Automatic
```

ファイアウォールで SSH（22 番）が開いているかも確かめます。何も出なければ、2 行目で開けます。

```powershell
Get-NetFirewallRule -Name *OpenSSH-Server* | Select-Object Name, Enabled, Profile
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

### 確かめる

ホストの Agent Kanban で上部の **「RC設定」** を開くと、**クライアントに入れる SSH の接続先（Tailscale の IP）・ユーザー名・SSH サーバーが動いているか** が表示されます。「動いていません」と出ていたら、上の手順をやり直してください。

## 3. SSH の鍵を作って、ホストに登録する

アプリからはパスワードを入力できないので、**鍵で SSH に入れる** ようにします。鍵を作るところまではクライアントのアプリがやり、**公開鍵のファイルをホストへ渡すのはご自身で** 行います（ホストのパスワードをアプリに渡さないためです）。受け取った公開鍵は、ホストのアプリで選ぶだけで登録できます。

### クライアントで鍵を作る（アプリでできます）

1. クライアントの Agent Kanban で上部の **「RC設定」** を開き、「クライアント」の接続方法を **SSH 経由** にします
2. 「① SSH の鍵を作る」の **「鍵を作る」** を押します。パスフレーズなしの ed25519 の鍵が `~/.ssh/agent-kanban_ed25519`（Windows は `C:\Users\<you>\.ssh\agent-kanban_ed25519`）にでき、「鍵ファイル」の欄に入ります
3. 公開鍵と、ホストに登録するコマンド（ホストが Mac / Windows の管理者 / Windows の管理者ではないユーザー）が出るので、**「コピー」** で写します

すでに使っている鍵があれば、「鍵ファイル」にそのパスを入れると、その公開鍵と登録コマンドが出ます（パスフレーズ付きの鍵は、アプリからは使えません）。自分で作るなら `ssh-keygen -t ed25519` でもかまいません。

Windows で「ssh-keygen が見つかりません」と出るときは、「設定 → システム → オプション機能」で「OpenSSH クライアント」を追加します。

### 公開鍵をホストに登録する（ホストの Agent Kanban で）

1. クライアントでできた **公開鍵のファイル**（`agent-kanban_ed25519.pub`。RC設定の「① SSH の鍵」に場所が出ています）を、USB メモリ・共有フォルダ・メールなどで、ホストの PC の好きな場所に置きます。**秘密鍵（`.pub` の付かない方）は渡さないでください**
2. ホストの Agent Kanban で上部の **「RC設定」** を開き、「ホスト」の **「操作側の公開鍵を登録する」** で **「ファイルを選択…」** から、置いた `.pub` を選びます
3. **「登録する」** を押すと、SSH で入れるように設定されます
   - Mac: `~/.ssh/authorized_keys` に足して、権限を 600 にします
   - Windows で管理者のユーザー: `C:\ProgramData\ssh\administrators_authorized_keys` に足して、`icacls` で権限を絞ります。書き込めないと出たときは、Agent Kanban を「管理者として実行」で開き直すか、表示されたコマンドを管理者の PowerShell で実行します
   - Windows で管理者ではないユーザー: `C:\Users\<you>\.ssh\authorized_keys` に足します

同じ鍵がもう登録されていれば、二重には足しません。秘密鍵を選んだときは登録せずに止めます。

アプリを使わずに登録するときは、クライアントの RC設定に出ている、ホストの OS に合ったコマンドを **ホストの PC で** 実行してもかまいません。下は、それを手で行うときの手順です。

### 公開鍵をホストに登録する（ホストが Mac のとき）

クライアントが **Windows** なら PowerShell で:

```powershell
type $env:USERPROFILE\.ssh\agent-kanban_ed25519.pub | ssh <ユーザー名>@<ホストの IP> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

クライアントが **Mac** ならターミナルで:

```bash
ssh-copy-id -i ~/.ssh/agent-kanban_ed25519.pub <ユーザー名>@<ホストの IP>
```

どちらも、このときだけホストのパスワードを聞かれます。ユーザー名は、ホストのターミナルで `whoami` と打つと出る名前です。

### 公開鍵をホストに登録する（ホストが Windows のとき）

Windows の OpenSSH サーバーは、**ホストのユーザーが管理者かどうか** で鍵を置く場所が変わります。

1. クライアントの `agent-kanban_ed25519.pub`（Windows なら `C:\Users\<you>\.ssh\agent-kanban_ed25519.pub`）をメモ帳などで開くか、RC設定の「公開鍵をコピー」で、1 行をまるごとコピーします
2. ホストで PowerShell を開き、次の `'…'` にその 1 行を貼って実行します

   **ホストのユーザーが管理者のとき**（ふつうの個人の PC はこちら。PowerShell は **管理者として実行**）:

   ```powershell
   $key = 'ssh-ed25519 AAAA... you@client'
   Add-Content -Path C:\ProgramData\ssh\administrators_authorized_keys -Value $key
   icacls.exe C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
   ```

   **管理者ではないとき**:

   ```powershell
   $key = 'ssh-ed25519 AAAA... you@client'
   New-Item -ItemType Directory -Force $env:USERPROFILE\.ssh | Out-Null
   Add-Content -Path $env:USERPROFILE\.ssh\authorized_keys -Value $key
   ```

ユーザー名は、ホストの PowerShell で `$env:USERNAME` と打つと出る名前です（Microsoft アカウントでも、メールアドレスではなくこの名前を使います）。

### パスワードなしで入れるか確かめる

クライアントで次を実行して、**パスワードを聞かれずに** 終われば準備完了です（RC設定の「③」にも、そのまま使えるコマンドが出ます）。

```bash
ssh -i ~/.ssh/agent-kanban_ed25519 <ユーザー名>@<ホストの IP> exit
```

初めてのときは「Are you sure you want to continue connecting」と聞かれるので `yes` と答えます。

## 4. つなぐ

1. **ホスト** の Agent Kanban で上部の「RC設定」→「ホストを開始」を押します（ペアリング用の 6 桁コードが出ます。待ち受けポートの既定は `17831`）
2. **クライアント** の Agent Kanban で上部の「RC設定」→ クライアントで次を入れて接続します
   - 接続方法: **SSH 経由**
   - SSH の接続先: ホストの Tailscale の IP（`100.x.x.x`）か名前（ホストの設定画面に出ている値）
   - ユーザー名: ホストのログイン名（ホストの設定画面に出ている値）
   - SSH ポート: `22`、鍵ファイル: アプリで作った鍵（「鍵を作る」を押すと自動で入ります）
   - ホストの待ち受けポート: `17831`、ペアリングコード: ホストに出ている 6 桁
3. 以降はトークンが保存されるので、コードなしで再接続できます。上部のピルに「遠隔操作中」と出ているあいだは、ホスト側のボード・承認・質問・追加指示がそのまま使えます。切断するとトンネルも閉じます

自分で `ssh -L 17831:127.0.0.1:17831 <user>@<host>` を張りたいときは、接続方法を「直接」にして接続先ホストを `127.0.0.1` にします。

## うまくいかないとき

| 出たメッセージ | よくある原因と直し方 |
| --- | --- |
| SSH の接続が **タイムアウト** しました | 相手から返事がありません。① 両方の PC で Tailscale が接続中か（管理画面で offline になっていないか、`tailscale ping <IP>` が返るか） ② IP・名前がホストの設定画面の値と合っているか ③ ホストがスリープしていないか ④ ホストで SSH サーバーが動いているか（上の「2.」） ⑤ ホストのファイアウォール（Mac の「ステルスモード」「外部からの接続をすべてブロック」、Windows の 22 番の受信規則）を確かめます |
| SSH の接続を **断られました** | ホストで SSH サーバーが動いていません（Mac は「リモートログイン」、Windows はサービス `sshd`）。SSH のポートが 22 以外なら、設定の「SSH ポート」も合わせます |
| SSH の **認証に失敗** しました | 鍵が登録されていないか、ユーザー名が違います。上の「3.」をやり直し、`ssh <ユーザー名>@<IP> exit` がパスワードなしで通るか確かめます。ホストが Windows で管理者のユーザーなら、`administrators_authorized_keys` に入れて `icacls` で権限を絞る必要があります |
| ホストの鍵が以前と違う | ホストを入れ直したなどで鍵が変わりました。クライアントで `ssh-keygen -R <IP>` を実行してから、もう一度つなぎます |
| SSH はつながりましたが、ホストの Agent Kanban に届きませんでした | ホストで「ホストを開始」していないか、待ち受けポートが違います |
| ポート転送を断られました | ホストの `sshd_config`（Mac は `/etc/ssh/sshd_config`、Windows は `C:\ProgramData\ssh\sshd_config`）で `AllowTcpForwarding no` になっています |
| ssh コマンドが見つかりません | Windows は「OpenSSH クライアント」を追加します。設定の「ssh コマンド」にフルパスを入れることもできます |

## そのほか

- ホストを止める・ペアを破棄する・トークンを忘れる操作も、同じ「RC設定」の画面にあります。上部の「遠隔操作中」「ホスト待ち受け」のピルを押しても開きます
- 遠隔操作中は、ボード・作業ディレクトリ（worktree）・エージェントはすべて **ホストのもの** です。左上のリポジトリ欄には、接続先の名前（`user@100.x.x.x` など）を付けて **ホストのパス** が出ます
- 遠隔操作中も、左上のリポジトリ欄から **ホストのリポジトリに切り替えられます**。ホストで最近開いたリポジトリを選ぶか、「ホストのフォルダを開く」でホストのフォルダをこの画面で辿って選びます（パスを直接入れて移動することもできます）。クローン・新規作成の「置き場所」の「選ぶ…」も、ホストのフォルダから選べます
- 「フォルダを開く」（Finder・エクスプローラー）はホストの画面に出てしまうため、遠隔操作中は使えません
- ペアリングコードは 10 分で切れ、5 回間違えると無効になります（ホスト側で再発行してください）。トークンなどの秘密は遠隔へは送りません
- あわせて、設定の「Claude カード起動時に公式 Remote Control も付ける」をオンにすると、カードで動かす Claude に `--remote-control` が付き、[claude.ai/code](https://claude.ai/code) や Claude アプリからも続けられます（CLI が対応している場合）

---

[← README に戻る](../README.md)
