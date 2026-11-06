(typeof module === 'object' && module.exports ? require('../i18n.js') : I18n).add({
  "RC設定（遠隔操作）": {
    "en": "RC settings (remote control)",
    "es": "Ajustes de RC (control remoto)",
    "fr": "Réglages RC (contrôle à distance)",
    "zh": "RC 设置（远程控制）"
  },
  "作業する PC（ホスト。Mac でも Windows でも）のボードを、別の PC（クライアント）から操作できます。この PC の役割をホストかクライアントのどちらかに選んでください。ホストは 127.0.0.1 だけで待ち受けるので、SSH のポート転送を通してつなぎます（手順は README の「遠隔操作」）。": {
    "en": "You can operate the board on the working PC (the host, Mac or Windows) from another PC (the client). Choose whether this PC is the host or the client. The host listens only on 127.0.0.1, so you connect through an SSH port forward (see “Remote control” in the README).",
    "es": "Puedes manejar el tablero del PC de trabajo (el host, Mac o Windows) desde otro PC (el cliente). Elige si este PC es el host o el cliente. El host solo escucha en 127.0.0.1, así que te conectas con un reenvío de puerto SSH (consulta «Control remoto» en el README).",
    "fr": "Vous pouvez piloter le tableau du PC de travail (l’hôte, Mac ou Windows) depuis un autre PC (le client). Choisissez si ce PC est l’hôte ou le client. L’hôte n’écoute que sur 127.0.0.1 : la connexion passe par un transfert de port SSH (voir « Contrôle à distance » dans le README).",
    "zh": "可以从另一台电脑（客户端）操作工作电脑（主机，Mac 或 Windows）上的看板。请选择这台电脑是主机还是客户端。主机只在 127.0.0.1 上监听，因此要通过 SSH 端口转发连接（步骤见 README 的「远程控制」）。"
  },
  "遠隔の状態を読み込み中…": {
    "en": "Loading remote status…",
    "es": "Cargando el estado remoto…",
    "fr": "Chargement de l’état distant…",
    "zh": "正在读取远程状态…"
  },
  "閉じる": {
    "en": "Close",
    "es": "Cerrar",
    "fr": "Fermer",
    "zh": "关闭"
  },
  "コピー": {
    "en": "Copy",
    "es": "Copiar",
    "fr": "Copier",
    "zh": "复制"
  },
  "<strong>① SSH の鍵を作る</strong>": {
    "en": "<strong>① Create an SSH key</strong>",
    "es": "<strong>① Crear una clave SSH</strong>",
    "fr": "<strong>① Créer une clé SSH</strong>",
    "zh": "<strong>① 创建 SSH 密钥</strong>"
  },
  "{v1} にまだ鍵がありません。このアプリで ssh-keygen を動かして、パスフレーズなしの ed25519 の鍵を作ります（アプリからはパスフレーズを入力できないため）。": {
    "en": "There is no key at {v1} yet. This app runs ssh-keygen to create an ed25519 key with no passphrase (the app cannot type a passphrase).",
    "es": "Todavía no hay una clave en {v1}. Esta aplicación ejecuta ssh-keygen para crear una clave ed25519 sin frase de contraseña (la aplicación no puede introducir una frase de contraseña).",
    "fr": "Il n’y a pas encore de clé dans {v1}. Cette application lance ssh-keygen pour créer une clé ed25519 sans phrase secrète (elle ne peut pas saisir de phrase secrète).",
    "zh": "{v1} 还没有密钥。本应用会运行 ssh-keygen，创建没有口令的 ed25519 密钥（应用无法输入口令）。"
  },
  "鍵を作る": {
    "en": "Create key",
    "es": "Crear clave",
    "fr": "Créer la clé",
    "zh": "创建密钥"
  },
  "SSH の鍵を作っています…": {
    "en": "Creating an SSH key…",
    "es": "Creando una clave SSH…",
    "fr": "Création d’une clé SSH…",
    "zh": "正在创建 SSH 密钥…"
  },
  "鍵を作りました。公開鍵のファイルをホストに渡して登録してください": {
    "en": "Key created. Give the public key file to the host and register it",
    "es": "Clave creada. Pasa el archivo de la clave pública al host y regístrala",
    "fr": "Clé créée. Transmettez le fichier de clé publique à l’hôte et enregistrez-la",
    "zh": "已创建密钥。请把公钥文件交给主机并注册"
  },
  "すでにある鍵を使います": {
    "en": "Using the key that is already there",
    "es": "Se usará la clave que ya existe",
    "fr": "Utilisation de la clé déjà présente",
    "zh": "使用已有的密钥"
  },
  "鍵 {v1} はありますが、公開鍵（{v2}）が読めません。ターミナルで <code>ssh-keygen -y -f \"{v3}\" &gt; \"{v4}\"</code> を実行して作り直してください。": {
    "en": "There is a key at {v1}, but the public key ({v2}) cannot be read. In a terminal, run <code>ssh-keygen -y -f \"{v3}\" &gt; \"{v4}\"</code> to recreate it.",
    "es": "Hay una clave en {v1}, pero no se puede leer la clave pública ({v2}). En un terminal, ejecuta <code>ssh-keygen -y -f \"{v3}\" &gt; \"{v4}\"</code> para volver a crearla.",
    "fr": "Une clé existe dans {v1}, mais la clé publique ({v2}) est illisible. Dans un terminal, exécutez <code>ssh-keygen -y -f \"{v3}\" &gt; \"{v4}\"</code> pour la recréer.",
    "zh": "密钥 {v1} 存在，但无法读取公钥（{v2}）。请在终端运行 <code>ssh-keygen -y -f \"{v3}\" &gt; \"{v4}\"</code> 重新生成。"
  },
  "<ユーザー名>": {
    "en": "<username>",
    "es": "<nombre de usuario>",
    "fr": "<nom d’utilisateur>",
    "zh": "<用户名>"
  },
  "<ホストの IP>": {
    "en": "<host IP>",
    "es": "<IP del host>",
    "fr": "<IP de l’hôte>",
    "zh": "<主机 IP>"
  },
  "<strong>① SSH の鍵</strong>: {v1}（できています）": {
    "en": "<strong>① SSH key</strong>: {v1} (ready)",
    "es": "<strong>① Clave SSH</strong>: {v1} (lista)",
    "fr": "<strong>① Clé SSH</strong> : {v1} (prête)",
    "zh": "<strong>① SSH 密钥</strong>：{v1}（已就绪）"
  },
  "公開鍵をコピー": {
    "en": "Copy public key",
    "es": "Copiar clave pública",
    "fr": "Copier la clé publique",
    "zh": "复制公钥"
  },
  "<strong>② 公開鍵をホストに渡す</strong>（ここはご自身で行ってください）": {
    "en": "<strong>② Give the public key to the host</strong> (you do this yourself)",
    "es": "<strong>② Entregar la clave pública al host</strong> (hazlo tú)",
    "fr": "<strong>② Transmettre la clé publique à l’hôte</strong> (à faire vous-même)",
    "zh": "<strong>② 把公钥交给主机</strong>（请自行完成）"
  },
  "公開鍵のファイル <b>{v1}</b> を、USB・共有フォルダ・メールなどでホストの PC の好きな場所に置き、ホストの Worktree Kanban の「RC設定」→「操作側の公開鍵を登録する」で選んで登録します。秘密鍵（{v2}）は渡さないでください。アプリを使わずに登録するなら、ホストの OS に合ったコマンドをホストで実行します:": {
    "en": "Put the public key file <b>{v1}</b> somewhere on the host PC (USB drive, shared folder, email, and so on), then in Worktree Kanban on the host choose “RC settings” → “Register the client public key”. Do not hand over the private key ({v2}). To register without the app, run the command that matches the host OS:",
    "es": "Coloca el archivo de la clave pública <b>{v1}</b> en el PC del host (USB, carpeta compartida, correo, etc.) y, en Worktree Kanban del host, elige «Ajustes de RC» → «Registrar la clave pública del cliente». No entregues la clave privada ({v2}). Para registrarla sin la aplicación, ejecuta en el host el comando según su sistema:",
    "fr": "Placez le fichier de clé publique <b>{v1}</b> quelque part sur le PC hôte (clé USB, dossier partagé, e-mail, etc.), puis dans Worktree Kanban sur l’hôte choisissez « Réglages RC » → « Enregistrer la clé publique du client ». Ne transmettez pas la clé privée ({v2}). Pour l’enregistrer sans l’application, exécutez sur l’hôte la commande adaptée à son OS :",
    "zh": "把公钥文件 <b>{v1}</b> 放到主机上的任意位置（U 盘、共享文件夹、邮件等），然后在主机的 Worktree Kanban 中选择「RC 设置」→「注册客户端公钥」。不要交出私钥（{v2}）。若不用应用注册，请在主机上按操作系统运行对应命令："
  },
  "ホストが Mac（ターミナルで）": {
    "en": "Host is a Mac (in Terminal)",
    "es": "El host es un Mac (en Terminal)",
    "fr": "L’hôte est un Mac (dans Terminal)",
    "zh": "主机是 Mac（在终端中）"
  },
  "ホストが Windows で、ユーザーが管理者（ふつうの個人の PC。PowerShell を「管理者として実行」で）": {
    "en": "Host is Windows and the user is an administrator (a typical personal PC; PowerShell “Run as administrator”)",
    "es": "El host es Windows y el usuario es administrador (un PC personal habitual; PowerShell «Ejecutar como administrador»)",
    "fr": "L’hôte est Windows et l’utilisateur est administrateur (un PC personnel courant ; PowerShell « Exécuter en tant qu’administrateur »)",
    "zh": "主机是 Windows，且用户是管理员（普通个人电脑；请用「以管理员身份运行」打开 PowerShell）"
  },
  "ホストが Windows で、ユーザーが管理者ではない（PowerShell で）": {
    "en": "Host is Windows and the user is not an administrator (in PowerShell)",
    "es": "El host es Windows y el usuario no es administrador (en PowerShell)",
    "fr": "L’hôte est Windows et l’utilisateur n’est pas administrateur (dans PowerShell)",
    "zh": "主机是 Windows，且用户不是管理员（在 PowerShell 中）"
  },
  "<strong>③ パスワードなしで入れるか確かめる</strong>（この PC のターミナルで。初回は yes と答えます）": {
    "en": "<strong>③ Check that you can log in without a password</strong> (in a terminal on this PC; answer yes the first time)",
    "es": "<strong>③ Comprueba que puedes entrar sin contraseña</strong> (en un terminal de este PC; la primera vez responde yes)",
    "fr": "<strong>③ Vérifier une connexion sans mot de passe</strong> (dans un terminal de ce PC ; répondez yes la première fois)",
    "zh": "<strong>③ 确认可以无密码登录</strong>（在这台电脑的终端中；第一次请回答 yes）"
  },
  "コピーしました": {
    "en": "Copied",
    "es": "Copiado",
    "fr": "Copié",
    "zh": "已复制"
  },
  "コピーできませんでした": {
    "en": "Could not copy",
    "es": "No se pudo copiar",
    "fr": "Impossible de copier",
    "zh": "无法复制"
  },
  "「設定 → システム → オプション機能」で「OpenSSH サーバー」を追加し、管理者の PowerShell で <code>Start-Service sshd; Set-Service sshd -StartupType Automatic</code> を実行してください": {
    "en": "In “Settings → System → Optional features”, add “OpenSSH Server”, then in an administrator PowerShell run <code>Start-Service sshd; Set-Service sshd -StartupType Automatic</code>",
    "es": "En «Configuración → Sistema → Características opcionales», agrega «Servidor OpenSSH» y, en PowerShell de administrador, ejecuta <code>Start-Service sshd; Set-Service sshd -StartupType Automatic</code>",
    "fr": "Dans « Paramètres → Système → Fonctionnalités facultatives », ajoutez « Serveur OpenSSH », puis dans PowerShell administrateur exécutez <code>Start-Service sshd; Set-Service sshd -StartupType Automatic</code>",
    "zh": "在「设置 → 系统 → 可选功能」中添加「OpenSSH 服务器」，然后在管理员 PowerShell 中运行 <code>Start-Service sshd; Set-Service sshd -StartupType Automatic</code>"
  },
  "「システム設定 → 一般 → 共有 → リモートログイン」をオンにしてください": {
    "en": "Turn on “System Settings → General → Sharing → Remote Login”",
    "es": "Activa «Ajustes del Sistema → General → Compartir → Inicio de sesión remoto»",
    "fr": "Activez « Réglages Système → Général → Partage → Session à distance »",
    "zh": "请打开「系统设置 → 通用 → 共享 → 远程登录」"
  },
  "SSH サーバー（sshd）を起動してください": {
    "en": "Start the SSH server (sshd)",
    "es": "Inicia el servidor SSH (sshd)",
    "fr": "Démarrez le serveur SSH (sshd)",
    "zh": "请启动 SSH 服务器（sshd）"
  },
  "操作側の「SSH の接続先」: {v1}\n    ユーザー名: {v2}\n    SSH サーバー（ポート {v3}）: {v4}": {
    "en": "Client “SSH host”: {v1}\n    Username: {v2}\n    SSH server (port {v3}): {v4}",
    "es": "«Destino SSH» del cliente: {v1}\n    Nombre de usuario: {v2}\n    Servidor SSH (puerto {v3}): {v4}",
    "fr": "« Hôte SSH » côté client : {v1}\n    Nom d’utilisateur : {v2}\n    Serveur SSH (port {v3}) : {v4}",
    "zh": "客户端的「SSH 连接地址」：{v1}\n    用户名：{v2}\n    SSH 服务器（端口 {v3}）：{v4}"
  },
  "{v1}（Tailscale の IP が見つかりません。Tailscale が接続中か確かめてください）": {
    "en": "{v1} (no Tailscale IP found. Check that Tailscale is connected)",
    "es": "{v1} (no se encontró la IP de Tailscale. Comprueba que Tailscale está conectado)",
    "fr": "{v1} (adresse IP Tailscale introuvable. Vérifiez que Tailscale est connecté)",
    "zh": "{v1}（找不到 Tailscale 的 IP。请确认 Tailscale 已连接）"
  },
  "動いています": {
    "en": "Running",
    "es": "En marcha",
    "fr": "En cours d’exécution",
    "zh": "正在运行"
  },
  "動いていません": {
    "en": "Not running",
    "es": "Detenido",
    "fr": "Arrêté",
    "zh": "未运行"
  },
  "このマシンの SSH サーバーが動いていないので、操作側からつなげません。{v1}": {
    "en": "The SSH server on this machine is not running, so the client cannot connect. {v1}",
    "es": "El servidor SSH de esta máquina no está en marcha, así que el cliente no puede conectar. {v1}",
    "fr": "Le serveur SSH de cette machine n’est pas démarré : le client ne peut pas se connecter. {v1}",
    "zh": "这台机器的 SSH 服务器没有运行，客户端无法连接。{v1}"
  },
  "<strong>操作側の公開鍵を登録する</strong>": {
    "en": "<strong>Register the client public key</strong>",
    "es": "<strong>Registrar la clave pública del cliente</strong>",
    "fr": "<strong>Enregistrer la clé publique du client</strong>",
    "zh": "<strong>注册客户端公钥</strong>"
  },
  "操作側の RC設定で作った公開鍵（agent-kanban_ed25519.pub）を、USB・共有フォルダ・メールなどでこの PC の好きな場所に置き、ここで選んで「登録する」を押すと、SSH で入れるように設定します（{v1} に足します）。": {
    "en": "Put the public key created in RC settings on the client (agent-kanban_ed25519.pub) somewhere on this PC (USB drive, shared folder, email, and so on), choose it here, and press “Register”. SSH login will be set up (added to {v1}).",
    "es": "Coloca en este PC la clave pública creada en los ajustes de RC del cliente (agent-kanban_ed25519.pub), mediante USB, carpeta compartida, correo, etc., elígela aquí y pulsa «Registrar». Así se permitirá el acceso por SSH (se añade a {v1}).",
    "fr": "Placez sur ce PC la clé publique créée dans les réglages RC du client (agent-kanban_ed25519.pub), via une clé USB, un dossier partagé, un e-mail, etc., choisissez-la ici et appuyez sur « Enregistrer ». La connexion SSH sera autorisée (ajout dans {v1}).",
    "zh": "把客户端在 RC 设置里创建的公钥（agent-kanban_ed25519.pub）放到这台电脑的任意位置（U 盘、共享文件夹、邮件等），在这里选中并按「注册」，即可允许 SSH 登录（写入 {v1}）。"
  },
  "管理者のユーザーは C:\\ProgramData\\ssh\\administrators_authorized_keys、それ以外は ~/.ssh/authorized_keys": {
    "en": "For an administrator: C:\\ProgramData\\ssh\\administrators_authorized_keys; otherwise ~/.ssh/authorized_keys",
    "es": "Si es administrador: C:\\ProgramData\\ssh\\administrators_authorized_keys; si no, ~/.ssh/authorized_keys",
    "fr": "Pour un administrateur : C:\\ProgramData\\ssh\\administrators_authorized_keys ; sinon ~/.ssh/authorized_keys",
    "zh": "管理员用户写入 C:\\ProgramData\\ssh\\administrators_authorized_keys，其他用户写入 ~/.ssh/authorized_keys"
  },
  "（まだ選んでいません）": {
    "en": "(none selected yet)",
    "es": "(aún no se ha elegido)",
    "fr": "(aucun fichier choisi)",
    "zh": "（尚未选择）"
  },
  "ファイルを選択…": {
    "en": "Choose file…",
    "es": "Elegir archivo…",
    "fr": "Choisir un fichier…",
    "zh": "选择文件…"
  },
  "登録する": {
    "en": "Register",
    "es": "Registrar",
    "fr": "Enregistrer",
    "zh": "注册"
  },
  "<strong>ホストとして待ち受け中</strong>（ポート {v1}・接続 {v2}・ペア済み {v3}）": {
    "en": "<strong>Listening as host</strong> (port {v1} · connections {v2} · paired {v3})",
    "es": "<strong>Escuchando como host</strong> (puerto {v1} · conexiones {v2} · emparejados {v3})",
    "fr": "<strong>En écoute comme hôte</strong> (port {v1} · connexions {v2} · appairés {v3})",
    "zh": "<strong>正在作为主机等待连接</strong>（端口 {v1} · 连接 {v2} · 已配对 {v3}）"
  },
  "ペアリングコード: <span class=\"pair-code\">{v1}</span>": {
    "en": "Pairing code: <span class=\"pair-code\">{v1}</span>",
    "es": "Código de emparejamiento: <span class=\"pair-code\">{v1}</span>",
    "fr": "Code d’appairage : <span class=\"pair-code\">{v1}</span>",
    "zh": "配对码：<span class=\"pair-code\">{v1}</span>"
  },
  "（期限切れ・再発行してください）": {
    "en": "(expired — issue a new one)",
    "es": "(caducado: vuelve a emitirlo)",
    "fr": "(expiré — émettez-en un nouveau)",
    "zh": "（已过期，请重新发放）"
  },
  "コードを再発行": {
    "en": "Issue a new code",
    "es": "Emitir otro código",
    "fr": "Émettre un nouveau code",
    "zh": "重新发放代码"
  },
  "ペアを破棄": {
    "en": "Drop pairings",
    "es": "Olvidar emparejamientos",
    "fr": "Oublier les appairages",
    "zh": "清除配对"
  },
  "ホストを停止": {
    "en": "Stop host",
    "es": "Detener el host",
    "fr": "Arrêter l’hôte",
    "zh": "停止主机"
  },
  "操作側の「クライアント」で「SSH 経由」を選び、下の接続先とユーザー名を入れて接続します。自分でトンネルを張るなら:": {
    "en": "On the client, choose “SSH”, then enter the host and username below. To open the tunnel yourself:",
    "es": "En el cliente, elige «Por SSH» e introduce el destino y el nombre de usuario de abajo. Si abres el túnel tú mismo:",
    "fr": "Côté client, choisissez « Via SSH », puis saisissez l’hôte et le nom d’utilisateur ci-dessous. Pour ouvrir le tunnel vous-même :",
    "zh": "在客户端选择「通过 SSH」，填入下面的地址和用户名后连接。若要自己建隧道："
  },
  "<strong>ホスト（作業側）</strong>": {
    "en": "<strong>Host (working side)</strong>",
    "es": "<strong>Host (lado de trabajo)</strong>",
    "fr": "<strong>Hôte (côté travail)</strong>",
    "zh": "<strong>主机（工作端）</strong>"
  },
  "<span>待ち受けポート</span>": {
    "en": "<span>Listen port</span>",
    "es": "<span>Puerto de escucha</span>",
    "fr": "<span>Port d’écoute</span>",
    "zh": "<span>监听端口</span>"
  },
  "ホストを開始（ペアリングコードを出す）": {
    "en": "Start host (show a pairing code)",
    "es": "Iniciar host (mostrar un código)",
    "fr": "Démarrer l’hôte (afficher un code)",
    "zh": "启动主机（显示配对码）"
  },
  "開始後、操作側の「クライアント」で「SSH 経由」を選び、下の接続先とユーザー名・コードで接続します（このマシンの SSH サーバーをオンにしておいてください）。自分でトンネルを張るなら:": {
    "en": "After it starts, on the client choose “SSH” and connect with the host, username, and code below (turn on this machine’s SSH server). To open the tunnel yourself:",
    "es": "Cuando arranque, en el cliente elige «Por SSH» y conecta con el destino, el usuario y el código de abajo (activa el servidor SSH de esta máquina). Si abres el túnel tú mismo:",
    "fr": "Une fois démarré, côté client choisissez « Via SSH » et connectez-vous avec l’hôte, le nom d’utilisateur et le code ci-dessous (activez le serveur SSH de cette machine). Pour ouvrir le tunnel vous-même :",
    "zh": "启动后，在客户端选择「通过 SSH」，用下面的地址、用户名和代码连接（请先打开这台机器的 SSH 服务器）。若要自己建隧道："
  },
  "SSH 経由 {v1}{v2}（ホストのポート {v3}）": {
    "en": "via SSH {v1}{v2} (host port {v3})",
    "es": "por SSH {v1}{v2} (puerto del host {v3})",
    "fr": "via SSH {v1}{v2} (port de l’hôte {v3})",
    "zh": "通过 SSH {v1}{v2}（主机端口 {v3}）"
  },
  "<strong>前回の接続を再開しています…</strong>（{v1}/{v2} 回目） → {v3}": {
    "en": "<strong>Resuming the previous connection…</strong> (attempt {v1}/{v2}) → {v3}",
    "es": "<strong>Reanudando la conexión anterior…</strong> (intento {v1}/{v2}) → {v3}",
    "fr": "<strong>Reprise de la connexion précédente…</strong> (tentative {v1}/{v2}) → {v3}",
    "zh": "<strong>正在恢复上次的连接…</strong>（第 {v1}/{v2} 次）→ {v3}"
  },
  "前回の失敗: {v1}": {
    "en": "Previous failure: {v1}",
    "es": "Fallo anterior: {v1}",
    "fr": "Échec précédent : {v1}",
    "zh": "上次失败：{v1}"
  },
  "再開をやめる": {
    "en": "Stop resuming",
    "es": "Dejar de reanudar",
    "fr": "Arrêter la reprise",
    "zh": "停止恢复"
  },
  "直接・{v1}:{v2}": {
    "en": "Direct · {v1}:{v2}",
    "es": "Directo · {v1}:{v2}",
    "fr": "Direct · {v1}:{v2}",
    "zh": "直接 · {v1}:{v2}"
  },
  "SSH 経由{v1}・ホストのポート {v2}": {
    "en": "via SSH{v1} · host port {v2}",
    "es": "por SSH{v1} · puerto del host {v2}",
    "fr": "via SSH{v1} · port de l’hôte {v2}",
    "zh": "通过 SSH{v1} · 主机端口 {v2}"
  },
  "（ポート {v1}）": {
    "en": " (port {v1})",
    "es": " (puerto {v1})",
    "fr": " (port {v1})",
    "zh": "（端口 {v1}）"
  },
  "<strong>これまでの接続</strong>（カードを押すと、保存したトークンでつなぎます）": {
    "en": "<strong>Previous connections</strong> (press a card to connect with the saved token)",
    "es": "<strong>Conexiones anteriores</strong> (pulsa una tarjeta para conectar con el token guardado)",
    "fr": "<strong>Connexions précédentes</strong> (appuyez sur une carte pour vous connecter avec le jeton enregistré)",
    "zh": "<strong>以往的连接</strong>（点击卡片，用已保存的令牌连接）"
  },
  "つながりませんでした: {v1}": {
    "en": "Could not connect: {v1}",
    "es": "No se pudo conectar: {v1}",
    "fr": "Connexion impossible : {v1}",
    "zh": "没能连上：{v1}"
  },
  "この接続先につなぐ": {
    "en": "Connect to this host",
    "es": "Conectar a este destino",
    "fr": "Se connecter à cette cible",
    "zh": "连接到这里"
  },
  "トークンがないので、6 桁のコードでペアリングし直してください": {
    "en": "No token. Pair again with the 6-digit code",
    "es": "No hay token. Vuelve a emparejar con el código de 6 dígitos",
    "fr": "Pas de jeton. Appariez à nouveau avec le code à 6 chiffres",
    "zh": "没有令牌。请用 6 位代码重新配对"
  },
  "<span class=\"rc-conn-badge\">前回</span>": {
    "en": "<span class=\"rc-conn-badge\">Last</span>",
    "es": "<span class=\"rc-conn-badge\">Anterior</span>",
    "fr": "<span class=\"rc-conn-badge\">Précédente</span>",
    "zh": "<span class=\"rc-conn-badge\">上次</span>"
  },
  "最後の接続: {v1}": {
    "en": "Last connection: {v1}",
    "es": "Última conexión: {v1}",
    "fr": "Dernière connexion : {v1}",
    "zh": "最后连接：{v1}"
  },
  "以前の版で接続": {
    "en": "Connected with an older version",
    "es": "Conectado con una versión anterior",
    "fr": "Connecté avec une version plus ancienne",
    "zh": "用旧版本连接过"
  },
  "コードでのペアリングが必要": {
    "en": "Pairing with a code is required",
    "es": "Hay que emparejar con un código",
    "fr": "Un appairage par code est nécessaire",
    "zh": "需要用代码配对"
  },
  "この接続を一覧から消す（トークンも忘れます）": {
    "en": "Remove this connection from the list (the token is forgotten too)",
    "es": "Quitar esta conexión de la lista (también se olvida el token)",
    "fr": "Retirer cette connexion de la liste (le jeton est oublié aussi)",
    "zh": "从列表中删除此连接（令牌也会忘掉）"
  },
  "新しい接続先につなぐときや、接続先を直すときは、下の欄を入れて接続します。": {
    "en": "To connect to a new host, or to fix the address, fill in the fields below and connect.",
    "es": "Para un destino nuevo, o para corregirlo, rellena los campos de abajo y conecta.",
    "fr": "Pour une nouvelle cible, ou pour la corriger, remplissez les champs ci-dessous et connectez-vous.",
    "zh": "连接新地址或修改地址时，请填写下面的栏再连接。"
  },
  "<strong>前回の接続</strong> → {v1}": {
    "en": "<strong>Previous connection</strong> → {v1}",
    "es": "<strong>Conexión anterior</strong> → {v1}",
    "fr": "<strong>Connexion précédente</strong> → {v1}",
    "zh": "<strong>上次的连接</strong> → {v1}"
  },
  "↻ 前回の接続を再開": {
    "en": "↻ Resume previous connection",
    "es": "↻ Reanudar la conexión anterior",
    "fr": "↻ Reprendre la connexion précédente",
    "zh": "↻ 恢复上次的连接"
  },
  "接続先を変えるときは、下の欄を直して「保存したトークンで接続」を押します。": {
    "en": "To change the host, edit the fields below and press “Connect with saved token”.",
    "es": "Para cambiar el destino, corrige los campos de abajo y pulsa «Conectar con el token guardado».",
    "fr": "Pour changer la cible, corrigez les champs ci-dessous et appuyez sur « Se connecter avec le jeton enregistré ».",
    "zh": "要更改连接地址时，请修改下面的栏，然后按「用已保存的令牌连接」。"
  },
  "<strong>クライアントとして接続中</strong> → {v1}": {
    "en": "<strong>Connected as client</strong> → {v1}",
    "es": "<strong>Conectado como cliente</strong> → {v1}",
    "fr": "<strong>Connecté comme client</strong> → {v1}",
    "zh": "<strong>已作为客户端连接</strong> → {v1}"
  },
  "アプリを終了しても、次に起動したときにこの接続を自動で再開します（回線が切れたときも、つなぎ直します）。「切断」を押すと、次からは自動で再開しません。": {
    "en": "This connection is resumed automatically the next time the app starts, even if you quit, and it reconnects if the link drops. “Disconnect” stops that automatic resume.",
    "es": "Aunque cierres la aplicación, la próxima vez se reanuda esta conexión sola, y también se reconecta si se corta la línea. «Desconectar» hace que deje de reanudarse sola.",
    "fr": "Même si vous quittez l’application, cette connexion reprend au prochain lancement, et elle se rétablit si la liaison coupe. « Déconnecter » empêche cette reprise automatique.",
    "zh": "即使退出应用，下次启动也会自动恢复此连接（断线时也会重连）。按「断开」后，下次不再自动恢复。"
  },
  "切断してローカルボードに戻る": {
    "en": "Disconnect and return to the local board",
    "es": "Desconectar y volver al tablero local",
    "fr": "Déconnecter et revenir au tableau local",
    "zh": "断开并回到本地看板"
  },
  "<strong>クライアント（操作側）</strong>": {
    "en": "<strong>Client (controlling side)</strong>",
    "es": "<strong>Cliente (lado que opera)</strong>",
    "fr": "<strong>Client (côté commande)</strong>",
    "zh": "<strong>客户端（操作端）</strong>"
  },
  "<span>接続方法</span>": {
    "en": "<span>Connection method</span>",
    "es": "<span>Método de conexión</span>",
    "fr": "<span>Méthode de connexion</span>",
    "zh": "<span>连接方式</span>"
  },
  "SSH 経由（アプリがトンネルを張る・おすすめ）": {
    "en": "via SSH (the app opens the tunnel · recommended)",
    "es": "Por SSH (la aplicación abre el túnel · recomendado)",
    "fr": "Via SSH (l’application ouvre le tunnel · recommandé)",
    "zh": "通过 SSH（应用建立隧道 · 推荐）"
  },
  "直接（自分で張ったトンネルの 127.0.0.1 などへ）": {
    "en": "Direct (to 127.0.0.1 of a tunnel you opened)",
    "es": "Directo (al 127.0.0.1 de un túnel que abriste)",
    "fr": "Direct (vers le 127.0.0.1 d’un tunnel que vous avez ouvert)",
    "zh": "直接（连到自己建立的隧道的 127.0.0.1 等）"
  },
  "<span>SSH の接続先（Tailscale の IP・名前など）</span>": {
    "en": "<span>SSH host (Tailscale IP, machine name, …)</span>",
    "es": "<span>Destino SSH (IP de Tailscale, nombre, etc.)</span>",
    "fr": "<span>Hôte SSH (IP Tailscale, nom, etc.)</span>",
    "zh": "<span>SSH 连接地址（Tailscale 的 IP、机器名等）</span>"
  },
  "100.x.x.x / マシン名": {
    "en": "100.x.x.x / machine name",
    "es": "100.x.x.x / nombre de la máquina",
    "fr": "100.x.x.x / nom de la machine",
    "zh": "100.x.x.x / 机器名"
  },
  "<span>ユーザー名（ホストのログイン名）</span>": {
    "en": "<span>Username (login name on the host)</span>",
    "es": "<span>Nombre de usuario (login del host)</span>",
    "fr": "<span>Nom d’utilisateur (identifiant sur l’hôte)</span>",
    "zh": "<span>用户名（主机上的登录名）</span>"
  },
  "<span>SSH ポート</span>": {
    "en": "<span>SSH port</span>",
    "es": "<span>Puerto SSH</span>",
    "fr": "<span>Port SSH</span>",
    "zh": "<span>SSH 端口</span>"
  },
  "<span>鍵ファイル（空ならこのアプリで作る ~/.ssh/agent-kanban_ed25519）</span>": {
    "en": "<span>Key file (empty: this app creates ~/.ssh/agent-kanban_ed25519)</span>",
    "es": "<span>Archivo de clave (vacío: esta aplicación crea ~/.ssh/agent-kanban_ed25519)</span>",
    "fr": "<span>Fichier de clé (vide : cette application crée ~/.ssh/agent-kanban_ed25519)</span>",
    "zh": "<span>密钥文件（留空则由本应用创建 ~/.ssh/agent-kanban_ed25519）</span>"
  },
  "<span>ssh コマンド</span>": {
    "en": "<span>ssh command</span>",
    "es": "<span>Comando ssh</span>",
    "fr": "<span>Commande ssh</span>",
    "zh": "<span>ssh 命令</span>"
  },
  "SSH は鍵で入れる必要があります（パスワードは入力できません）。ホスト側で SSH サーバーをオンにしてください（Mac は「リモートログイン」、Windows は「OpenSSH サーバー」）。接続先とユーザー名は、ホストの Worktree Kanban のこの画面に出ています。": {
    "en": "SSH must use a key (a password cannot be typed). Turn on the SSH server on the host (Remote Login on Mac, OpenSSH Server on Windows). The host and username are shown on this screen in Worktree Kanban on the host.",
    "es": "SSH tiene que entrar con clave (no se puede escribir una contraseña). Activa el servidor SSH en el host (en Mac, «Inicio de sesión remoto»; en Windows, «Servidor OpenSSH»). El destino y el usuario aparecen en esta pantalla de Worktree Kanban en el host.",
    "fr": "SSH doit utiliser une clé (un mot de passe ne peut pas être saisi). Activez le serveur SSH sur l’hôte (« Session à distance » sur Mac, « Serveur OpenSSH » sur Windows). L’hôte et le nom d’utilisateur s’affichent sur cet écran d’Worktree Kanban sur l’hôte.",
    "zh": "SSH 必须用密钥登录（无法输入密码）。请在主机上打开 SSH 服务器（Mac 为「远程登录」，Windows 为「OpenSSH 服务器」）。连接地址和用户名显示在主机 Worktree Kanban 的这个画面上。"
  },
  "SSH の鍵を確かめています…": {
    "en": "Checking the SSH key…",
    "es": "Comprobando la clave SSH…",
    "fr": "Vérification de la clé SSH…",
    "zh": "正在确认 SSH 密钥…"
  },
  "<span>接続先ホスト</span>": {
    "en": "<span>Host</span>",
    "es": "<span>Host de destino</span>",
    "fr": "<span>Hôte de destination</span>",
    "zh": "<span>目标主机</span>"
  },
  "<span>ホストの待ち受けポート</span>": {
    "en": "<span>Host listen port</span>",
    "es": "<span>Puerto de escucha del host</span>",
    "fr": "<span>Port d’écoute de l’hôte</span>",
    "zh": "<span>主机监听端口</span>"
  },
  "<span>ペアリングコード（初回のみ。トークンがあれば空で再接続）</span>": {
    "en": "<span>Pairing code (first time only; leave empty to reconnect if a token exists)</span>",
    "es": "<span>Código de emparejamiento (solo la primera vez; vacío para reconectar si hay token)</span>",
    "fr": "<span>Code d’appairage (première fois seulement ; vide pour se reconnecter s’il y a un jeton)</span>",
    "zh": "<span>配对码（仅首次。已有令牌时留空即可重连）</span>"
  },
  "6桁": {
    "en": "6 digits",
    "es": "6 dígitos",
    "fr": "6 chiffres",
    "zh": "6 位"
  },
  "保存したトークンで接続": {
    "en": "Connect with saved token",
    "es": "Conectar con el token guardado",
    "fr": "Se connecter avec le jeton enregistré",
    "zh": "用已保存的令牌连接"
  },
  "コードでペアリング": {
    "en": "Pair with code",
    "es": "Emparejar con código",
    "fr": "Apparier avec le code",
    "zh": "用代码配对"
  },
  "<button class=\"btn small\" type=\"button\" id=\"rForgetToken\">トークンを忘れる</button>": {
    "en": "<button class=\"btn small\" type=\"button\" id=\"rForgetToken\">Forget token</button>",
    "es": "<button class=\"btn small\" type=\"button\" id=\"rForgetToken\">Olvidar token</button>",
    "fr": "<button class=\"btn small\" type=\"button\" id=\"rForgetToken\">Oublier le jeton</button>",
    "zh": "<button class=\"btn small\" type=\"button\" id=\"rForgetToken\">忘记令牌</button>"
  },
  "直接のときは、先に <code>{v1}</code> を張り、接続先ホストは 127.0.0.1 のままにします（ホストは 127.0.0.1 でしか待ち受けないので、Tailscale の IP を直接入れてもつながりません）": {
    "en": "For a direct connection, open <code>{v1}</code> first and leave the host as 127.0.0.1 (the host listens only on 127.0.0.1, so a Tailscale IP entered directly will not connect)",
    "es": "En modo directo, abre primero <code>{v1}</code> y deja el host en 127.0.0.1 (el host solo escucha en 127.0.0.1, así que una IP de Tailscale puesta directamente no conecta)",
    "fr": "En direct, ouvrez d’abord <code>{v1}</code> et laissez l’hôte sur 127.0.0.1 (l’hôte n’écoute que sur 127.0.0.1 : une IP Tailscale saisie directement ne se connecte pas)",
    "zh": "直接连接时，请先建立 <code>{v1}</code>，目标主机保持 127.0.0.1（主机只在 127.0.0.1 上监听，直接填写 Tailscale 的 IP 也连不上）"
  },
  "ホスト（作業側）": {
    "en": "Host (working side)",
    "es": "Host (lado de trabajo)",
    "fr": "Hôte (côté travail)",
    "zh": "主机（工作端）"
  },
  "クライアントとして接続中は選べません。先に切断してください": {
    "en": "Unavailable while connected as a client. Disconnect first",
    "es": "No se puede elegir mientras estás conectado como cliente. Desconecta antes",
    "fr": "Indisponible pendant une connexion en tant que client. Déconnectez-vous d’abord",
    "zh": "作为客户端连接时不能选择。请先断开"
  },
  "クライアント（操作側）": {
    "en": "Client (controlling side)",
    "es": "Cliente (lado que opera)",
    "fr": "Client (côté commande)",
    "zh": "客户端（操作端）"
  },
  "ホストとして待ち受け中は選べません。先にホストを停止してください": {
    "en": "Unavailable while listening as a host. Stop the host first",
    "es": "No se puede elegir mientras el host está escuchando. Detén el host antes",
    "fr": "Indisponible pendant l’écoute en tant qu’hôte. Arrêtez d’abord l’hôte",
    "zh": "作为主机等待连接时不能选择。请先停止主机"
  },
  "<small class=\"muted\">ホストとして待ち受け中なので、クライアントには切り替えられません（ホストを停止すると選べます）。</small>": {
    "en": "<small class=\"muted\">Listening as a host, so you cannot switch to client (you can after stopping the host).</small>",
    "es": "<small class=\"muted\">Está escuchando como host, así que no puedes pasar a cliente (podrás al detener el host).</small>",
    "fr": "<small class=\"muted\">En écoute comme hôte : impossible de passer en client (possible après l’arrêt de l’hôte).</small>",
    "zh": "<small class=\"muted\">正在作为主机等待连接，不能切换到客户端（停止主机后就可以选）。</small>"
  },
  "<small class=\"muted\">クライアントとして接続中なので、ホストには切り替えられません（切断すると選べます）。</small>": {
    "en": "<small class=\"muted\">Connected as a client, so you cannot switch to host (you can after disconnecting).</small>",
    "es": "<small class=\"muted\">Estás conectado como cliente, así que no puedes pasar a host (podrás al desconectar).</small>",
    "fr": "<small class=\"muted\">Connecté comme client : impossible de passer en hôte (possible après la déconnexion).</small>",
    "zh": "<small class=\"muted\">正在作为客户端连接，不能切换到主机（断开后就可以选）。</small>"
  },
  "ホストを開始しています…": {
    "en": "Starting the host…",
    "es": "Iniciando el host…",
    "fr": "Démarrage de l’hôte…",
    "zh": "正在启动主机…"
  },
  "ホストを停止しています…": {
    "en": "Stopping the host…",
    "es": "Deteniendo el host…",
    "fr": "Arrêt de l’hôte…",
    "zh": "正在停止主机…"
  },
  "コードを発行しています…": {
    "en": "Issuing a code…",
    "es": "Emitiendo un código…",
    "fr": "Émission d’un code…",
    "zh": "正在发放代码…"
  },
  "ペアリング済みのクライアントをすべて無効にしますか？": {
    "en": "Invalidate every paired client?",
    "es": "¿Invalidar todos los clientes emparejados?",
    "fr": "Invalider tous les clients appairés ?",
    "zh": "要让所有已配对的客户端失效吗？"
  },
  "ペアを破棄しています…": {
    "en": "Dropping pairings…",
    "es": "Olvidando emparejamientos…",
    "fr": "Suppression des appairages…",
    "zh": "正在清除配对…"
  },
  "SSH の接続先（Tailscale の IP か名前）を入れてください": {
    "en": "Enter the SSH host (Tailscale IP or name)",
    "es": "Introduce el destino SSH (IP o nombre de Tailscale)",
    "fr": "Saisissez l’hôte SSH (IP ou nom Tailscale)",
    "zh": "请填写 SSH 连接地址（Tailscale 的 IP 或名称）"
  },
  "SSH トンネルを張って接続しています…": {
    "en": "Opening an SSH tunnel and connecting…",
    "es": "Abriendo un túnel SSH y conectando…",
    "fr": "Ouverture d’un tunnel SSH et connexion…",
    "zh": "正在建立 SSH 隧道并连接…"
  },
  "接続しています…": {
    "en": "Connecting…",
    "es": "Conectando…",
    "fr": "Connexion…",
    "zh": "正在连接…"
  },
  "公開鍵を読み込んでいます…": {
    "en": "Reading the public key…",
    "es": "Leyendo la clave pública…",
    "fr": "Lecture de la clé publique…",
    "zh": "正在读取公钥…"
  },
  "鍵: {v1}{v2}": {
    "en": "Key: {v1}{v2}",
    "es": "Clave: {v1}{v2}",
    "fr": "Clé : {v1}{v2}",
    "zh": "密钥：{v1}{v2}"
  },
  "（{v1}）": {
    "en": " ({v1})",
    "es": " ({v1})",
    "fr": " ({v1})",
    "zh": "（{v1}）"
  },
  "公開鍵のファイルを選んでください": {
    "en": "Choose a public key file",
    "es": "Elige el archivo de la clave pública",
    "fr": "Choisissez le fichier de clé publique",
    "zh": "请选择公钥文件"
  },
  "公開鍵を登録しています…": {
    "en": "Registering the public key…",
    "es": "Registrando la clave pública…",
    "fr": "Enregistrement de la clé publique…",
    "zh": "正在注册公钥…"
  },
  "{v1}: {v2}<br />操作側で「SSH 経由」・接続先・ユーザー名（下の値）を入れて接続できます。": {
    "en": "{v1}: {v2}<br />On the client, choose “via SSH” and enter the host and username (the values below) to connect.",
    "es": "{v1}: {v2}<br />En el cliente, elige «Por SSH» e introduce el destino y el usuario (los valores de abajo) para conectar.",
    "fr": "{v1} : {v2}<br />Côté client, choisissez « Via SSH » et saisissez l’hôte et le nom d’utilisateur (les valeurs ci-dessous) pour vous connecter.",
    "zh": "{v1}：{v2}<br />在客户端选择「通过 SSH」，填入连接地址和用户名（下面的值）即可连接。"
  },
  "登録しました": {
    "en": "Registered",
    "es": "Registrada",
    "fr": "Enregistrée",
    "zh": "已注册"
  },
  "この鍵はもう登録されています": {
    "en": "This key is already registered",
    "es": "Esta clave ya está registrada",
    "fr": "Cette clé est déjà enregistrée",
    "zh": "此密钥已经注册过"
  },
  "公開鍵を登録しました": {
    "en": "Public key registered",
    "es": "Clave pública registrada",
    "fr": "Clé publique enregistrée",
    "zh": "已注册公钥"
  },
  "SSH トンネルを張って、前回の接続を再開しています…": {
    "en": "Opening an SSH tunnel and resuming the previous connection…",
    "es": "Abriendo un túnel SSH y reanudando la conexión anterior…",
    "fr": "Ouverture d’un tunnel SSH et reprise de la connexion précédente…",
    "zh": "正在建立 SSH 隧道并恢复上次的连接…"
  },
  "前回の接続を再開しています…": {
    "en": "Resuming the previous connection…",
    "es": "Reanudando la conexión anterior…",
    "fr": "Reprise de la connexion précédente…",
    "zh": "正在恢复上次的连接…"
  },
  "{v1} につないでいます…": {
    "en": "Connecting to {v1}…",
    "es": "Conectando a {v1}…",
    "fr": "Connexion à {v1}…",
    "zh": "正在连接 {v1}…"
  },
  "SSH トンネルを張って、{v1} につないでいます…": {
    "en": "Opening an SSH tunnel and connecting to {v1}…",
    "es": "Abriendo un túnel SSH y conectando a {v1}…",
    "fr": "Ouverture d’un tunnel SSH et connexion à {v1}…",
    "zh": "正在建立 SSH 隧道并连接 {v1}…"
  },
  "「{v1}」を、これまでの接続から消しますか？（保存したトークンも忘れます）": {
    "en": "Remove “{v1}” from previous connections? (the saved token is forgotten too)",
    "es": "¿Quitar «{v1}» de las conexiones anteriores? (también se olvida el token guardado)",
    "fr": "Retirer « {v1} » des connexions précédentes ? (le jeton enregistré est oublié aussi)",
    "zh": "要从以往的连接中删除「{v1}」吗？（已保存的令牌也会忘掉）"
  },
  "接続を消しています…": {
    "en": "Removing the connection…",
    "es": "Eliminando la conexión…",
    "fr": "Suppression de la connexion…",
    "zh": "正在删除连接…"
  },
  "再開をやめています…": {
    "en": "Stopping resume…",
    "es": "Deteniendo la reanudación…",
    "fr": "Arrêt de la reprise…",
    "zh": "正在停止恢复…"
  },
  "切断しています…": {
    "en": "Disconnecting…",
    "es": "Desconectando…",
    "fr": "Déconnexion…",
    "zh": "正在断开…"
  },
  "トークンを消しています…": {
    "en": "Removing the token…",
    "es": "Eliminando el token…",
    "fr": "Suppression du jeton…",
    "zh": "正在删除令牌…"
  },
  "チェックアウト中のブランチ{v1}": {
    "en": "Checked-out branch{v1}",
    "es": "Rama actual{v1}",
    "fr": "Branche extraite{v1}",
    "zh": "当前检出的分支{v1}"
  },
  "（今は {v1}）": {
    "en": " (now {v1})",
    "es": " (ahora {v1})",
    "fr": " (actuellement {v1})",
    "zh": "（当前是 {v1}）"
  },
  "ここの項目は、どのプロジェクトでも同じです。": {
    "en": "These settings are the same for every project.",
    "es": "Estas opciones son las mismas en todos los proyectos.",
    "fr": "Ces réglages sont les mêmes pour tous les projets.",
    "zh": "这里的项目在所有项目中都相同。"
  },
  "言語": {
    "en": "Language",
    "es": "Idioma",
    "fr": "Langue",
    "zh": "语言"
  },
  "表示の言語です。選ぶとすぐに保存して、画面を読み直します。": {
    "en": "Display language. The choice is saved immediately and the screen reloads.",
    "es": "Idioma de la interfaz. Al elegirlo se guarda al momento y se vuelve a cargar la pantalla.",
    "fr": "Langue d’affichage. Le choix est enregistré tout de suite et l’écran est rechargé.",
    "zh": "界面语言。选择后会立即保存并重新加载画面。"
  },
  "<span>同時に動かす数</span>": {
    "en": "<span>How many run at once</span>",
    "es": "<span>Cuántos a la vez</span>",
    "fr": "<span>Nombre en parallèle</span>",
    "zh": "<span>同时运行的数量</span>"
  },
  "タスクが完了したとき、前に完了したタスクと似た作業が続いていたら、スキルにしないか通知で聞く（右上のベル）": {
    "en": "When a task finishes, if the work resembles tasks you finished before, ask in a notification (the bell at the top right) whether to turn it into a skill",
    "es": "Cuando termina una tarea, si el trabajo se parece a tareas ya terminadas, preguntar con una notificación (la campana de arriba a la derecha) si conviene hacer un skill",
    "fr": "Quand une tâche se termine, si le travail ressemble à des tâches déjà terminées, demander par une notification (la cloche en haut à droite) s’il faut en faire un skill",
    "zh": "任务完成时，如果之前完成的任务也是类似的工作，就用通知询问要不要做成技能（右上角的铃铛）"
  },
  "マージして完了したら、そのタスクの作業に使った Claude Code の会話（セッション）を消す（引き継いだ元の会話は残します）": {
    "en": "When a merge completes the task, delete the Claude Code conversation (session) used for that work (the original conversation it continued from is kept)",
    "es": "Al fusionar y completar, borrar la conversación de Claude Code (sesión) usada en ese trabajo (la conversación original de la que se partió se conserva)",
    "fr": "Après une fusion qui termine la tâche, supprimer la conversation Claude Code (session) utilisée pour ce travail (la conversation d’origine reprise est conservée)",
    "zh": "合并并完成后，删除该任务所用的 Claude Code 对话（会话）（接手来的原对话会保留）"
  },
  "「このプロジェクト」の項目{v1}は、プロジェクト（リポジトリ）ごとに覚えます。タブを切り替えると、そのプロジェクトの設定に変わります。初めて開いたプロジェクトは初期値から始まります。": {
    "en": "Settings under “This project”{v1} are remembered per repository. Switching tabs switches to that project’s settings. A project opened for the first time starts from the defaults.",
    "es": "Las opciones de «Este proyecto»{v1} se recuerdan por repositorio. Al cambiar de pestaña cambian los ajustes de ese proyecto. Un proyecto abierto por primera vez empieza con los valores iniciales.",
    "fr": "Les réglages de « Ce projet »{v1} sont mémorisés par dépôt. Changer d’onglet charge les réglages de ce projet. Un projet ouvert pour la première fois part des valeurs initiales.",
    "zh": "「此项目」中的项{v1}会按仓库分别记住。切换标签会换成该项目的设置。第一次打开的项目从初始值开始。"
  },
  "（<code>{v1}</code>）": {
    "en": " (<code>{v1}</code>)",
    "es": " (<code>{v1}</code>)",
    "fr": " (<code>{v1}</code>)",
    "zh": "（<code>{v1}</code>）"
  },
  "<span>ベースブランチ（worktree の作成元・マージ先）</span>": {
    "en": "<span>Base branch (where worktrees are created and merged)</span>",
    "es": "<span>Rama base (origen del worktree y destino del merge)</span>",
    "fr": "<span>Branche de base (origine du worktree et cible du merge)</span>",
    "zh": "<span>基础分支（创建 worktree 与合并的目标）</span>"
  },
  "<span>レビュー後の取り込み方</span>": {
    "en": "<span>How to land after review</span>",
    "es": "<span>Cómo integrar tras la revisión</span>",
    "fr": "<span>Intégration après la revue</span>",
    "zh": "<span>审查之后如何并入</span>"
  },
  "直接マージする（ローカルで git merge）": {
    "en": "Merge directly (local git merge)",
    "es": "Fusionar directamente (git merge local)",
    "fr": "Fusionner directement (git merge local)",
    "zh": "直接合并（本地 git merge）"
  },
  "PR を作成する（origin に push して gh pr create）": {
    "en": "Create a PR (push to origin and gh pr create)",
    "es": "Crear un PR (push a origin y gh pr create)",
    "fr": "Créer une PR (push vers origin et gh pr create)",
    "zh": "创建 PR（push 到 origin 并 gh pr create）"
  },
  "レビュー中のタスクに出るボタンが「マージ」か「PR を作成」に変わります。PR の作成には gh のインストールとログインが必要です。": {
    "en": "The button on a task in review becomes “Merge” or “Create PR”. Creating a PR needs gh installed and logged in.",
    "es": "El botón de una tarea en revisión pasa a ser «Fusionar» o «Crear PR». Crear un PR exige tener gh instalado y la sesión iniciada.",
    "fr": "Le bouton d’une tâche en revue devient « Fusionner » ou « Créer une PR ». Créer une PR exige gh installé et connecté.",
    "zh": "审查中的任务上的按钮会变成「合并」或「创建 PR」。创建 PR 需要安装 gh 并登录。"
  },
  "<span>ブランチの命名規則（自然言語で書けます）</span>": {
    "en": "<span>Branch naming rule (you can write it in plain language)</span>",
    "es": "<span>Regla para nombrar ramas (puedes escribirla en lenguaje natural)</span>",
    "fr": "<span>Règle de nom de branche (en langage naturel)</span>",
    "zh": "<span>分支命名规则（可以用自然语言写）</span>"
  },
  "例: feature/<Issue番号>-<内容を表す短い英語> にする。Issue がないときは feature/<内容を表す短い英語>": {
    "en": "Example: feature/<issue number>-<short English summary>. If there is no issue, feature/<short English summary>",
    "es": "Ejemplo: feature/<número de issue>-<resumen corto en inglés>. Si no hay issue, feature/<resumen corto en inglés>",
    "fr": "Exemple : feature/<numéro d’issue>-<court résumé en anglais>. Sans issue : feature/<court résumé en anglais>",
    "zh": "例：feature/<Issue 编号>-<简短英文概括>。没有 Issue 时用 feature/<简短英文概括>"
  },
  "書いておくと、タスクの開始時にそのタスクのエージェントがこの規則に従ってブランチ名を考えます。空なら agent/issue-12-xxxx のような名前になります。決められなかったときも、この名前になります。": {
    "en": "If you write one, the task’s agent names the branch by this rule when the task starts. If it is empty, or the agent cannot decide, the name looks like agent/issue-12-xxxx.",
    "es": "Si escribes una, el agente de la tarea inventa el nombre de la rama según esta regla al empezar. Si está vacía, o no puede decidir, el nombre será como agent/issue-12-xxxx.",
    "fr": "Si vous en écrivez une, l’agent de la tâche nomme la branche selon cette règle au démarrage. Si elle est vide, ou s’il ne peut pas décider, le nom ressemble à agent/issue-12-xxxx.",
    "zh": "写上之后，任务开始时该任务的智能体会按此规则起分支名。留空或决定不了时，会用 agent/issue-12-xxxx 这样的名字。"
  },
  "Issue のステータスを自動で変える（GitHub Projects）": {
    "en": "Update Issue status automatically (GitHub Projects)",
    "es": "Cambiar el estado del Issue automáticamente (GitHub Projects)",
    "fr": "Changer le statut de l’Issue automatiquement (GitHub Projects)",
    "zh": "自动更改 Issue 的状态（GitHub Projects）"
  },
  "Issue から作ったタスクが「実行中」になると In progress、「レビュー」になると In review、マージして「完了」になると Done に、Issue が入っている Project の Status を変えます。gh に project の権限が必要です。": {
    "en": "When a task created from an Issue becomes “Running”, set In progress; “Review”, In review; and after a merge to “Done”, Done, on the Project Status of that Issue. gh needs the project scope.",
    "es": "Cuando una tarea creada desde un Issue pasa a «En ejecución», pon In progress; a «Revisión», In review; y al fusionar y pasar a «Hecho», Done, en el Status del Project donde está el Issue. gh necesita el permiso project.",
    "fr": "Quand une tâche créée depuis une Issue passe à « En cours », mettre In progress ; à « Revue », In review ; et après fusion vers « Terminé », Done, dans le Status du Project de l’Issue. gh a besoin du droit project.",
    "zh": "从 Issue 创建的任务变为「执行中」时设为 In progress，「审查」时设为 In review，合并后变为「完成」时设为 Done，即该 Issue 所在 Project 的 Status。gh 需要 project 权限。"
  },
  "<span>変える項目（Project の単一選択フィールド名。空なら Status）</span>": {
    "en": "<span>Field to change (single-select field name on the Project; Status if empty)</span>",
    "es": "<span>Campo a cambiar (nombre del campo de selección única del Project; Status si está vacío)</span>",
    "fr": "<span>Champ à modifier (nom du champ à choix unique du Project ; Status si vide)</span>",
    "zh": "<span>要改的字段（Project 的单选字段名。留空则用 Status）</span>"
  },
  "<span>実行中 →</span>": {
    "en": "<span>Running →</span>",
    "es": "<span>En ejecución →</span>",
    "fr": "<span>En cours →</span>",
    "zh": "<span>执行中 →</span>"
  },
  "自動（In progress など）": {
    "en": "Automatic (In progress, and similar)",
    "es": "Automático (In progress, etc.)",
    "fr": "Automatique (In progress, etc.)",
    "zh": "自动（In progress 等）"
  },
  "<span>レビュー →</span>": {
    "en": "<span>Review →</span>",
    "es": "<span>Revisión →</span>",
    "fr": "<span>Revue →</span>",
    "zh": "<span>审查 →</span>"
  },
  "自動（In review など）": {
    "en": "Automatic (In review, and similar)",
    "es": "Automático (In review, etc.)",
    "fr": "Automatique (In review, etc.)",
    "zh": "自动（In review 等）"
  },
  "<span>完了 →</span>": {
    "en": "<span>Done →</span>",
    "es": "<span>Hecho →</span>",
    "fr": "<span>Terminé →</span>",
    "zh": "<span>完成 →</span>"
  },
  "自動（Done など）": {
    "en": "Automatic (Done, and similar)",
    "es": "Automático (Done, etc.)",
    "fr": "Automatique (Done, etc.)",
    "zh": "自动（Done 等）"
  },
  "列ごとに使う選択肢の名前を指定できます（カンマ区切りで候補を複数書けます。大文字小文字・絵文字・記号は無視して比べます）。空の列は名前から自動で探します。": {
    "en": "You can name the option used for each column (several candidates, separated by commas. Case, emoji, and symbols are ignored). An empty column is found from the name automatically.",
    "es": "Puedes indicar el nombre de la opción de cada columna (varios candidatos separados por comas. Se ignoran mayúsculas, emojis y símbolos). Una columna vacía se busca sola por el nombre.",
    "fr": "Vous pouvez indiquer le nom de l’option de chaque colonne (plusieurs candidats séparés par des virgules. Casse, émojis et symboles sont ignorés). Une colonne vide est trouvée automatiquement d’après le nom.",
    "zh": "可以指定每一列使用的选项名（用逗号分隔多个候选。比较时忽略大小写、表情和符号）。空着的列会按名称自动查找。"
  },
  "gh（GitHub CLI）を確認しています…": {
    "en": "Checking gh (GitHub CLI)…",
    "es": "Comprobando gh (GitHub CLI)…",
    "fr": "Vérification de gh (GitHub CLI)…",
    "zh": "正在确认 gh（GitHub CLI）…"
  },
  "<span>権限モード</span>": {
    "en": "<span>Permission mode</span>",
    "es": "<span>Modo de permisos</span>",
    "fr": "<span>Mode d’autorisation</span>",
    "zh": "<span>权限模式</span>"
  },
  "自動で許可されない操作は、カードに「承認待ち」として表示されます。": {
    "en": "Actions that are not allowed automatically appear on the card as “waiting for approval”.",
    "es": "Lo que no se permite automáticamente aparece en la tarjeta como «esperando aprobación».",
    "fr": "Ce qui n’est pas autorisé automatiquement apparaît sur la carte comme « en attente d’approbation ».",
    "zh": "不会自动允许的操作会在卡片上显示为「等待批准」。"
  },
  "毎回確認する（すべての操作をカードで承認）": {
    "en": "Ask every time (approve every action on a card)",
    "es": "Preguntar cada vez (aprobar todas las acciones en una tarjeta)",
    "fr": "Demander à chaque fois (approuver chaque action sur une carte)",
    "zh": "每次都确认（所有操作都在卡片上批准）"
  },
  "ファイル編集は自動で許可、コマンドなどは確認する（おすすめ）": {
    "en": "Allow file edits automatically, and confirm commands and the rest (recommended)",
    "es": "Permitir automáticamente las ediciones de archivos y confirmar los comandos y lo demás (recomendado)",
    "fr": "Autoriser automatiquement les modifications de fichiers, et confirmer les commandes et le reste (recommandé)",
    "zh": "自动允许文件编辑，命令等操作需要确认（推荐）"
  },
  "計画だけ立てる（ファイルは変更しない）": {
    "en": "Plan only (do not change files)",
    "es": "Solo planificar (no modificar archivos)",
    "fr": "Planifier seulement (ne pas modifier les fichiers)",
    "zh": "只制定计划（不修改文件）"
  },
  "すべて自動で許可する（注意）": {
    "en": "Allow everything automatically (caution)",
    "es": "Permitir todo automáticamente (precaución)",
    "fr": "Tout autoriser automatiquement (attention)",
    "zh": "全部自动允许（注意）"
  },
  "<span>Claude Code に最初から許可しておくツール（カンマか改行で区切る）</span>": {
    "en": "<span>Tools to allow Claude Code from the start (separate with commas or new lines)</span>",
    "es": "<span>Herramientas que Claude Code puede usar desde el principio (separadas por comas o saltos de línea)</span>",
    "fr": "<span>Outils autorisés d’emblée pour Claude Code (virgules ou retours à la ligne)</span>",
    "zh": "<span>一开始就允许 Claude Code 使用的工具（用逗号或换行分隔）</span>"
  },
  "例: Bash(npm test:*), Bash(git status), WebSearch": {
    "en": "Example: Bash(npm test:*), Bash(git status), WebSearch",
    "es": "Ejemplo: Bash(npm test:*), Bash(git status), WebSearch",
    "fr": "Exemple : Bash(npm test:*), Bash(git status), WebSearch",
    "zh": "例：Bash(npm test:*), Bash(git status), WebSearch"
  },
  "<span>新しいタスクで最初から選んでおくスキル</span>": {
    "en": "<span>Skill selected by default on a new task</span>",
    "es": "<span>Skill elegido de entrada en una tarea nueva</span>",
    "fr": "<span>Skill sélectionné d’emblée pour une nouvelle tâche</span>",
    "zh": "<span>新建任务时预先选中的技能</span>"
  },
  "「＋ 新しいタスク」（自然言語・Issue のどちらでも）を開いたときに、このスキルが選ばれた状態になります（その場で外したり変えたりできます）。": {
    "en": "When you open “+ New task” (plain language or an Issue), this skill is already selected (you can clear or change it there).",
    "es": "Al abrir «+ Nueva tarea» (lenguaje natural o Issue), este skill ya está elegido (puedes quitarlo o cambiarlo ahí).",
    "fr": "Quand vous ouvrez « + Nouvelle tâche » (langage naturel ou Issue), ce skill est déjà choisi (vous pouvez l’enlever ou le changer sur place).",
    "zh": "打开「＋ 新建任务」（自然语言或 Issue）时，会预先选中这个技能（当场可以去掉或更换）。"
  },
  "新しいタスクの内容が詰まっていなければ、開発を始める前にエージェントと対話して仕様を詰める": {
    "en": "If a new task is not specific enough, talk with the agent to pin down the spec before development starts",
    "es": "Si una tarea nueva no está bastante definida, dialogar con el agente para concretar la especificación antes de empezar a desarrollar",
    "fr": "Si une nouvelle tâche n’est pas assez précise, en discuter avec l’agent pour fixer le cahier des charges avant de développer",
    "zh": "如果新任务的内容还不够具体，就在开始开发前先和智能体对话把规格定下来"
  },
  "仕様を詰めるときに、分けたほうがよい大きなタスクなら、エージェントがサブタスクに分けることを提案します（「サブタスクでやる」と答えたら分けます）。開始前のタスクには、進捗タブから手動でサブタスクを足せます（足したあとは「サブタスク」タブで見られます）。": {
    "en": "While pinning down the spec, if a large task should be split, the agent may suggest subtasks (it splits them if you answer “do it as subtasks”). Before a task starts, you can also add subtasks from the progress tab (afterwards they appear on the “Subtasks” tab).",
    "es": "Al concretar la especificación, si una tarea grande conviene dividirla, el agente puede proponer subtasks (las divide si respondes «hacerlo en subtasks»). Antes de empezar, también puedes añadir subtasks desde la pestaña de progreso (después se ven en la pestaña «Subtasks»).",
    "fr": "Pendant la mise au point, si une grande tâche devrait être découpée, l’agent peut proposer des sous-tâches (il les crée si vous répondez « faire en sous-tâches »). Avant le démarrage, vous pouvez aussi en ajouter depuis l’onglet de progression (elles apparaissent ensuite dans l’onglet « Sous-tâches »).",
    "zh": "在把规格定下来时，如果大任务适合拆开，智能体会提议分成子任务（回答「用子任务来做」就会拆分）。开始前也可以从进度标签手动添加子任务（添加后可在「子任务」标签查看）。"
  },
  "<span>サブタスクが終わったら（既定。タスクごとに開始前に変えられます）</span>": {
    "en": "<span>When a subtask finishes (default; can be changed per task before it starts)</span>",
    "es": "<span>Cuando termina un subtask (valor por defecto; se puede cambiar en cada tarea antes de empezar)</span>",
    "fr": "<span>Quand une sous-tâche se termine (valeur par défaut ; modifiable par tâche avant le démarrage)</span>",
    "zh": "<span>子任务结束后（默认值。每个任务在开始前可以改）</span>"
  },
  "自動で親のブランチにマージする": {
    "en": "Merge into the parent branch automatically",
    "es": "Fusionar automáticamente en la rama padre",
    "fr": "Fusionner automatiquement dans la branche parente",
    "zh": "自动合并到父分支"
  },
  "確かめてからマージする": {
    "en": "Merge after I check it",
    "es": "Fusionar después de comprobarlo",
    "fr": "Fusionner après vérification",
    "zh": "确认后再合并"
  },
  "ここの項目は、どのプロジェクトでも同じです（「このプロジェクトの設定」と書いた項目だけは、プロジェクトごとに覚えます）。": {
    "en": "These settings are the same for every project (only items marked “this project’s settings” are remembered per project).",
    "es": "Estas opciones son las mismas en todos los proyectos (solo las marcadas como «ajustes de este proyecto» se recuerdan por proyecto).",
    "fr": "Ces réglages sont les mêmes pour tous les projets (seuls ceux indiqués comme « réglages de ce projet » sont mémorisés par projet).",
    "zh": "这里的项目在所有项目中都相同（只有写着「此项目的设置」的项会按项目记住）。"
  },
  "チェックを付けたエージェントだけ、コマンドとモデルを設定でき、タスク・会話・Pipeline・競争で選べます（1つ以上）。": {
    "en": "Only checked agents can have a command and model, and can be chosen for tasks, chat, Pipeline, and competition (at least one).",
    "es": "Solo los agentes marcados pueden tener comando y modelo, y se pueden elegir en tareas, conversación, Pipeline y competición (al menos uno).",
    "fr": "Seuls les agents cochés ont une commande et un modèle, et peuvent être choisis pour les tâches, la conversation, Pipeline et la compétition (au moins un).",
    "zh": "只有勾选的智能体可以设置命令和模型，并在任务、对话、Pipeline 和竞争中选用（至少一个）。"
  },
  "<span>claude コマンドのパス</span>": {
    "en": "<span>Path to the claude command</span>",
    "es": "<span>Ruta del comando claude</span>",
    "fr": "<span>Chemin de la commande claude</span>",
    "zh": "<span>claude 命令的路径</span>"
  },
  "<span>モデル（空なら既定）</span>": {
    "en": "<span>Model (empty for the default)</span>",
    "es": "<span>Modelo (vacío para el predeterminado)</span>",
    "fr": "<span>Modèle (vide pour la valeur par défaut)</span>",
    "zh": "<span>模型（留空则用默认）</span>"
  },
  "例: sonnet / opus": {
    "en": "Example: sonnet / opus",
    "es": "Ejemplo: sonnet / opus",
    "fr": "Exemple : sonnet / opus",
    "zh": "例：sonnet / opus"
  },
  "<span>codex コマンドのパス</span>": {
    "en": "<span>Path to the codex command</span>",
    "es": "<span>Ruta del comando codex</span>",
    "fr": "<span>Chemin de la commande codex</span>",
    "zh": "<span>codex 命令的路径</span>"
  },
  "例: gpt-5-codex": {
    "en": "Example: gpt-5-codex",
    "es": "Ejemplo: gpt-5-codex",
    "fr": "Exemple : gpt-5-codex",
    "zh": "例：gpt-5-codex"
  },
  "<span>gemini コマンドのパス</span>": {
    "en": "<span>Path to the gemini command</span>",
    "es": "<span>Ruta del comando gemini</span>",
    "fr": "<span>Chemin de la commande gemini</span>",
    "zh": "<span>gemini 命令的路径</span>"
  },
  "例: gemini-2.5-pro": {
    "en": "Example: gemini-2.5-pro",
    "es": "Ejemplo: gemini-2.5-pro",
    "fr": "Exemple : gemini-2.5-pro",
    "zh": "例：gemini-2.5-pro"
  },
  "<span>cursor-agent コマンドのパス</span>": {
    "en": "<span>Path to the cursor-agent command</span>",
    "es": "<span>Ruta del comando cursor-agent</span>",
    "fr": "<span>Chemin de la commande cursor-agent</span>",
    "zh": "<span>cursor-agent 命令的路径</span>"
  },
  "例: gpt-5 / sonnet-4.5": {
    "en": "Example: gpt-5 / sonnet-4.5",
    "es": "Ejemplo: gpt-5 / sonnet-4.5",
    "fr": "Exemple : gpt-5 / sonnet-4.5",
    "zh": "例：gpt-5 / sonnet-4.5"
  },
  "Claude Code は、自動で許可されない操作をカードで承認できます。Codex / Gemini / Cursor はカードでの承認に対応していないため、権限モードに合わせて CLI 側で許可します（計画だけ → 読み取りのみ、すべて自動で許可 → 確認なし、それ以外 → Codex は worktree の中だけ書ける sandbox・Gemini はファイル編集だけ自動で許可・Cursor は --force でファイル編集とコマンドを許可（Cursor の cli-config.json の deny は守られます））。": {
    "en": "Claude Code can approve actions that are not allowed automatically, on the card. Codex / Gemini / Cursor cannot approve on the card, so the CLI allows them according to the permission mode (plan only → read-only; allow everything → no prompts; otherwise Codex can write only inside the worktree sandbox, Gemini auto-allows file edits only, and Cursor allows file edits and commands with --force, while deny in Cursor’s cli-config.json is still honored).",
    "es": "Claude Code puede aprobar en la tarjeta lo que no se permite automáticamente. Codex / Gemini / Cursor no aprueban en la tarjeta, así que el CLI los permite según el modo de permisos (solo plan → solo lectura; permitir todo → sin confirmación; en los demás casos Codex solo escribe dentro del sandbox del worktree, Gemini permite automáticamente solo la edición de archivos y Cursor permite edición y comandos con --force; el deny de cli-config.json de Cursor se respeta).",
    "fr": "Claude Code peut approuver sur la carte ce qui n’est pas autorisé automatiquement. Codex / Gemini / Cursor ne le peuvent pas : le CLI autorise selon le mode (plan seul → lecture seule ; tout autoriser → sans confirmation ; sinon Codex n’écrit que dans le sandbox du worktree, Gemini autorise seulement l’édition de fichiers, et Cursor autorise fichiers et commandes avec --force, tout en respectant deny dans cli-config.json de Cursor).",
    "zh": "Claude Code 可以把不会自动允许的操作放到卡片上批准。Codex / Gemini / Cursor 不能在卡片上批准，因此会按权限模式在 CLI 侧允许（只做计划 → 只读；全部自动允许 → 不再确认；其他情况：Codex 只能在 worktree 的 sandbox 里写，Gemini 只自动允许编辑文件，Cursor 用 --force 允许编辑文件和命令，仍遵守 Cursor 的 cli-config.json 里的 deny）。"
  },
  "<span>新しいタスク・会話で最初から選んでおくエージェント</span>": {
    "en": "<span>Agent selected by default for new tasks and chat</span>",
    "es": "<span>Agente elegido de entrada en tareas y conversaciones nuevas</span>",
    "fr": "<span>Agent choisi d’emblée pour les nouvelles tâches et conversations</span>",
    "zh": "<span>新建任务和对话时预先选中的智能体</span>"
  },
  "オーケストレーションで Pipeline・競争を選んでいれば、タスクを作るときの「エージェント」の欄では、そちらを最初から選んでおきます（使えない状態のときや会話では、このエージェント）。競争の比較も、このエージェントに頼みます（スキルの提案は、元のタスクのエージェントが使えればそちらに頼みます）。": {
    "en": "If orchestration is set to Pipeline or competition, that choice is selected first in the “Agent” field when you create a task (this agent is used when that choice is unavailable, and for chat). Competition comparison also uses this agent (skill suggestions use the original task’s agent when it is available).",
    "es": "Si la orquestación es Pipeline o competición, eso aparece elegido en el campo «Agente» al crear una tarea (si no se puede usar, o en una conversación, se usa este agente). La comparación de la competición también se pide a este agente (la propuesta de skills se pide al agente de la tarea original si está disponible).",
    "fr": "Si l’orchestration est Pipeline ou compétition, ce choix est présélectionné dans le champ « Agent » à la création d’une tâche (cet agent sert s’il est indisponible, et pour la conversation). La comparaison de la compétition lui est aussi demandée (la proposition de skills revient à l’agent de la tâche d’origine s’il est disponible).",
    "zh": "如果编排选了 Pipeline 或竞争，新建任务时「智能体」一栏会预先选中它（不可用时以及对话中则用这个智能体）。竞争的比较也交给这个智能体（技能建议在原任务的智能体可用时交给它）。"
  },
  "カスタムエージェントは、このプロジェクトの設定です。": {
    "en": "Custom agents are settings for this project.",
    "es": "Los agentes personalizados son ajustes de este proyecto.",
    "fr": "Les agents personnalisés sont des réglages de ce projet.",
    "zh": "自定义智能体是此项目的设置。"
  },
  "＋ カスタムエージェントを追加": {
    "en": "+ Add a custom agent",
    "es": "+ Añadir un agente personalizado",
    "fr": "+ Ajouter un agent personnalisé",
    "zh": "＋ 添加自定义智能体"
  },
  "元にするエージェント（CLI）とモデルに、プロフィール（名前・アイコンと色・説明・振る舞いの指示）を持たせます。タスク・会話を作るときの「エージェント」の欄、Pipelineの工程、競争で選べます。振る舞いの指示は、最初の指示の前に付けて渡します。": {
    "en": "Give a base agent (CLI) and model a profile (name, icon and color, description, and behavior instructions). You can choose it in the “Agent” field for tasks and chat, in Pipeline steps, and in competition. Behavior instructions are prepended to the first prompt.",
    "es": "Añade a un agente base (CLI) y un modelo un perfil (nombre, icono y color, descripción e instrucciones de comportamiento). Se puede elegir en el campo «Agente» de tareas y conversaciones, en los pasos de Pipeline y en la competición. Las instrucciones de comportamiento se anteponen a la primera indicación.",
    "fr": "Donnez à un agent de base (CLI) et un modèle un profil (nom, icône et couleur, description, consignes de comportement). Il se choisit dans le champ « Agent » des tâches et conversations, dans les étapes de Pipeline et dans la compétition. Les consignes sont ajoutées avant la première instruction.",
    "zh": "在基础智能体（CLI）和模型上加上档案（名称、图标和颜色、说明、行为指示）。可以在新建任务和对话的「智能体」栏、Pipeline 的工序以及竞争中选用。行为指示会加在第一条指示之前。"
  },
  "<span>使うオーケストレーション（Pipelineと競争は、どちらか1つだけ使えます。使わないこともできます）</span>": {
    "en": "<span>Orchestration to use (Pipeline and competition: at most one; you can use neither)</span>",
    "es": "<span>Orquestación en uso (Pipeline y competición: solo una; también puedes no usar ninguna)</span>",
    "fr": "<span>Orchestration utilisée (Pipeline et compétition : une seule ; aucune est possible)</span>",
    "zh": "<span>使用的编排（Pipeline 和竞争只能用其中一个，也可以都不用）</span>"
  },
  "{v1}競争": {
    "en": "{v1}Competition",
    "es": "{v1}Competición",
    "fr": "{v1}Compétition",
    "zh": "{v1}竞争"
  },
  "なし": {
    "en": "None",
    "es": "Ninguna",
    "fr": "Aucune",
    "zh": "无"
  },
  "選んだ方だけ、タスクを作るときに「エージェント」の欄で選べます。「なし」なら、いつも1つのエージェントで動かします（Pipeline・競争の設定は消えずに残ります）。": {
    "en": "Only the one you choose appears in the “Agent” field when you create a task. “None” always runs a single agent (Pipeline and competition settings are kept).",
    "es": "Solo la que elijas aparece en el campo «Agente» al crear una tarea. «Ninguna» usa siempre un solo agente (los ajustes de Pipeline y competición se conservan).",
    "fr": "Seul le choix retenu apparaît dans le champ « Agent » à la création d’une tâche. « Aucune » lance toujours un seul agent (les réglages Pipeline et compétition restent).",
    "zh": "只有选中的那一种会出现在新建任务的「智能体」栏。「无」则始终用一个智能体（Pipeline 和竞争的设置会保留）。"
  },
  "<span>{v1}Pipeline（このプロジェクトの設定。いくつでも作れます）</span>": {
    "en": "<span>{v1}Pipeline (settings for this project. You can keep as many as you like)</span>",
    "es": "<span>{v1}Pipeline (ajustes de este proyecto. Puedes crear los que quieras)</span>",
    "fr": "<span>{v1}Pipeline (réglages de ce projet. Vous pouvez en créer autant que vous voulez)</span>",
    "zh": "<span>{v1}Pipeline（此项目的设置。可以建任意多个）</span>"
  },
  "＋ Pipelineを追加": {
    "en": "+ Add a Pipeline",
    "es": "+ Añadir un Pipeline",
    "fr": "+ Ajouter un Pipeline",
    "zh": "＋ 添加 Pipeline"
  },
  "インポート（.json / .zip）": {
    "en": "Import (.json / .zip)",
    "es": "Importar (.json / .zip)",
    "fr": "Importer (.json / .zip)",
    "zh": "导入（.json / .zip）"
  },
  "まとめてエクスポート（zip）": {
    "en": "Export together (zip)",
    "es": "Exportar juntos (zip)",
    "fr": "Exporter ensemble (zip)",
    "zh": "一起导出（zip）"
  },
  "工程（エージェントと担当の説明）を線でつなぎ、分岐（if）・ループ・並列を組めます。工程が終わるたびに変更をコミットし、最後の報告と一緒に次の工程へ渡します。タスクを作るときに、どの Pipeline で動かすかを選べます（「既定」のものを最初から選んでおきます）。<br />\n        「エクスポート」は Pipeline 1つを .json に、「まとめてエクスポート」は選んだ Pipeline とカスタムエージェントを zip にします。インポートは .json か zip を選びます（同じ中身のカスタムエージェントがあればそれを使い、なければ足します）。Pipeline の一覧の変更は、すぐに保存します。": {
    "en": "Connect steps (an agent and a description of the work) with lines, and add branches (if), loops, and parallel paths. Each finished step is committed and passed to the next step with the last report. When you create a task, you choose which Pipeline runs it (the one marked “Default” is selected first).<br />\n        “Export” writes one Pipeline to .json; “Export together” writes the selected Pipelines and custom agents to a zip. Import reads a .json or a zip (an identical custom agent is reused, otherwise it is added). Changes to the Pipeline list are saved immediately.",
    "es": "Une los pasos (un agente y la descripción de su trabajo) con líneas, y añade ramas (if), bucles y caminos en paralelo. Cada paso terminado se confirma y se pasa al siguiente junto con el último informe. Al crear una tarea eliges qué Pipeline la ejecuta (el marcado como «Predeterminado» sale elegido).<br />\n        «Exportar» escribe un Pipeline en .json; «Exportar juntos» escribe los Pipeline elegidos y los agentes personalizados en un zip. Importar lee un .json o un zip (si ya hay un agente personalizado igual, se usa; si no, se añade). Los cambios de la lista de Pipeline se guardan al momento.",
    "fr": "Reliez les étapes (un agent et la description de son travail) par des traits, et ajoutez des branches (if), des boucles et du parallèle. Chaque étape terminée est validée puis transmise à la suivante avec le dernier compte-rendu. À la création d’une tâche, vous choisissez le Pipeline (celui marqué « Par défaut » est présélectionné).<br />\n        « Exporter » écrit un Pipeline en .json ; « Exporter ensemble » écrit les Pipeline choisis et les agents personnalisés dans un zip. L’import lit un .json ou un zip (un agent personnalisé identique est réutilisé, sinon il est ajouté). Les changements de la liste sont enregistrés tout de suite.",
    "zh": "把工序（智能体和负责的说明）用线连起来，可以组成分支（if）、循环和并行。每道工序结束都会提交，并连同最后的报告交给下一道工序。新建任务时可以选择用哪个 Pipeline（预先选中标为「默认」的那个）。<br />\n        「导出」把一个 Pipeline 写成 .json，「一起导出」把选中的 Pipeline 和自定义智能体打成 zip。导入读取 .json 或 zip（已有相同的自定义智能体就用它，否则添加）。Pipeline 列表的更改会立即保存。"
  },
  "<span>{v1}競争させるエージェント（2つ以上）</span>": {
    "en": "<span>{v1}Agents to compete (two or more)</span>",
    "es": "<span>{v1}Agentes que compiten (dos o más)</span>",
    "fr": "<span>{v1}Agents en compétition (deux ou plus)</span>",
    "zh": "<span>{v1}参与竞争的智能体（两个以上）</span>"
  },
  "使うエージェントにチェックを付けたものと、このプロジェクトのカスタムエージェントから選べます（カスタムエージェントの選択は、プロジェクトごとに覚えます）。": {
    "en": "Choose from the agents you checked and from this project’s custom agents (the custom-agent choice is remembered per project).",
    "es": "Elige entre los agentes marcados y los agentes personalizados de este proyecto (esa elección se recuerda por proyecto).",
    "fr": "Choisissez parmi les agents cochés et les agents personnalisés de ce projet (ce choix est mémorisé par projet).",
    "zh": "可以从勾选要使用的智能体和此项目的自定义智能体中选择（自定义智能体的选择按项目记住）。"
  },
  "設定の項目": {
    "en": "Settings sections",
    "es": "Secciones de ajustes",
    "fr": "Rubriques des réglages",
    "zh": "设置项目"
  },
  "元に戻す": {
    "en": "Revert",
    "es": "Deshacer cambios",
    "fr": "Revenir",
    "zh": "还原"
  },
  "保存": {
    "en": "Save",
    "es": "Guardar",
    "fr": "Enregistrer",
    "zh": "保存"
  },
  "（使わない設定）": {
    "en": " (not enabled)",
    "es": " (no se usa)",
    "fr": " (non utilisé)",
    "zh": "（设为不使用）"
  },
  "編集": {
    "en": "Edit",
    "es": "Editar",
    "fr": "Modifier",
    "zh": "编辑"
  },
  "削除": {
    "en": "Delete",
    "es": "Eliminar",
    "fr": "Supprimer",
    "zh": "删除"
  },
  "<div class=\"muted small\">まだありません</div>": {
    "en": "<div class=\"muted small\">None yet</div>",
    "es": "<div class=\"muted small\">Todavía no hay</div>",
    "fr": "<div class=\"muted small\">Aucun pour l’instant</div>",
    "zh": "<div class=\"muted small\">还没有</div>"
  },
  "カスタムエージェント「{v1}」を削除しますか？{v2}\n（作ってあるタスクは、そのまま動きます）": {
    "en": "Delete the custom agent “{v1}”?{v2}\n(Tasks already created keep running as they are)",
    "es": "¿Eliminar el agente personalizado «{v1}»?{v2}\n(Las tareas ya creadas siguen igual)",
    "fr": "Supprimer l’agent personnalisé « {v1} » ?{v2}\n(Les tâches déjà créées continuent telles quelles)",
    "zh": "要删除自定义智能体「{v1}」吗？{v2}\n（已经创建的任务会照常运行）"
  },
  "\nPipelineの工程で使っています。削除すると、その工程を選び直すまでPipelineを始められません。": {
    "en": "\nA Pipeline step uses it. Until you choose that step again, the Pipeline cannot start.",
    "es": "\nUn paso del Pipeline lo usa. Hasta que vuelvas a elegir ese paso, el Pipeline no puede empezar.",
    "fr": "\nUne étape de Pipeline l’utilise. Tant que vous ne choisissez pas à nouveau cette étape, le Pipeline ne peut pas démarrer.",
    "zh": "\nPipeline 的工序正在使用它。在重新选择该工序之前，无法开始 Pipeline。"
  },
  "カスタムエージェントを追加": {
    "en": "Add a custom agent",
    "es": "Añadir un agente personalizado",
    "fr": "Ajouter un agent personnalisé",
    "zh": "添加自定义智能体"
  },
  "「{v1}」を編集": {
    "en": "Edit “{v1}”",
    "es": "Editar «{v1}»",
    "fr": "Modifier « {v1} »",
    "zh": "编辑「{v1}」"
  },
  "<span>名前</span>": {
    "en": "<span>Name</span>",
    "es": "<span>Nombre</span>",
    "fr": "<span>Nom</span>",
    "zh": "<span>名称</span>"
  },
  "例: 慎重なレビュアー": {
    "en": "Example: a careful reviewer",
    "es": "Ejemplo: un revisor prudente",
    "fr": "Exemple : un relecteur prudent",
    "zh": "例：谨慎的审查者"
  },
  "<span>アイコン（絵文字）</span>": {
    "en": "<span>Icon (emoji)</span>",
    "es": "<span>Icono (emoji)</span>",
    "fr": "<span>Icône (emoji)</span>",
    "zh": "<span>图标（表情）</span>"
  },
  "絵文字か1文字": {
    "en": "An emoji or one character",
    "es": "Un emoji o un carácter",
    "fr": "Un emoji ou un caractère",
    "zh": "表情或一个字"
  },
  "<span>色</span>": {
    "en": "<span>Color</span>",
    "es": "<span>Color</span>",
    "fr": "<span>Couleur</span>",
    "zh": "<span>颜色</span>"
  },
  "<span>説明（役割の一言）</span>": {
    "en": "<span>Description (one line about the role)</span>",
    "es": "<span>Descripción (una frase sobre el papel)</span>",
    "fr": "<span>Description (une phrase sur le rôle)</span>",
    "zh": "<span>说明（一句话说明角色）</span>"
  },
  "例: セキュリティとテストの抜けを重点的に見る": {
    "en": "Example: focuses on security and missing tests",
    "es": "Ejemplo: se fija sobre todo en la seguridad y en los tests que faltan",
    "fr": "Exemple : regarde surtout la sécurité et les tests manquants",
    "zh": "例：重点看安全和测试的遗漏"
  },
  "<span>元にするエージェント</span>": {
    "en": "<span>Base agent</span>",
    "es": "<span>Agente de base</span>",
    "fr": "<span>Agent de base</span>",
    "zh": "<span>作为基础的智能体</span>"
  },
  "<span>モデル（空なら設定の既定）</span>": {
    "en": "<span>Model (empty for the settings default)</span>",
    "es": "<span>Modelo (vacío para el predeterminado de ajustes)</span>",
    "fr": "<span>Modèle (vide pour la valeur des réglages)</span>",
    "zh": "<span>模型（留空则用设置里的默认）</span>"
  },
  "<span>振る舞いの指示（性格・やり方。最初の指示の前に付けます）</span>": {
    "en": "<span>Behavior instructions (style and method; prepended to the first prompt)</span>",
    "es": "<span>Instrucciones de comportamiento (estilo y método; se anteponen a la primera indicación)</span>",
    "fr": "<span>Consignes de comportement (style et méthode ; ajoutées avant la première instruction)</span>",
    "zh": "<span>行为指示（性格和做法。加在第一条指示之前）</span>"
  },
  "例: 変更は小さく保ち、直す前に必ず理由を説明してください。テストが通るまで完了にしないでください。": {
    "en": "Example: keep changes small, and always explain why before editing. Do not finish until the tests pass.",
    "es": "Ejemplo: mantén los cambios pequeños y explica siempre el motivo antes de corregir. No des por terminado hasta que pasen los tests.",
    "fr": "Exemple : gardez les changements petits et expliquez toujours pourquoi avant de modifier. Ne terminez pas tant que les tests ne passent pas.",
    "zh": "例：改动保持很小，修改前一定先说明理由。测试通过之前不要算完成。"
  },
  "やめる": {
    "en": "Cancel",
    "es": "Cancelar",
    "fr": "Annuler",
    "zh": "取消"
  },
  "追加": {
    "en": "Add",
    "es": "Añadir",
    "fr": "Ajouter",
    "zh": "添加"
  },
  "決定": {
    "en": "OK",
    "es": "Aceptar",
    "fr": "Valider",
    "zh": "确定"
  },
  "例: {v1}（設定の既定）": {
    "en": "Example: {v1} (settings default)",
    "es": "Ejemplo: {v1} (predeterminado de ajustes)",
    "fr": "Exemple : {v1} (valeur des réglages)",
    "zh": "例：{v1}（设置里的默认）"
  },
  "例: {v1}": {
    "en": "Example: {v1}",
    "es": "Ejemplo: {v1}",
    "fr": "Exemple : {v1}",
    "zh": "例：{v1}"
  },
  "（名前）": {
    "en": "(name)",
    "es": "(nombre)",
    "fr": "(nom)",
    "zh": "（名称）"
  },
  "名前を入れてください": {
    "en": "Enter a name",
    "es": "Escribe un nombre",
    "fr": "Saisissez un nom",
    "zh": "请填写名称"
  },
  "モデル名に使えない文字が入っています: {v1}": {
    "en": "The model name contains a character that cannot be used: {v1}",
    "es": "El nombre del modelo tiene un carácter que no se puede usar: {v1}",
    "fr": "Le nom du modèle contient un caractère interdit : {v1}",
    "zh": "模型名里有不能使用的字符：{v1}"
  },
  "「{v1}」という名前のカスタムエージェントはもうあります": {
    "en": "A custom agent named “{v1}” already exists",
    "es": "Ya hay un agente personalizado llamado «{v1}»",
    "fr": "Un agent personnalisé nommé « {v1} » existe déjà",
    "zh": "已经有名为「{v1}」的自定义智能体"
  },
  "プロジェクトが変わったので保存しませんでした": {
    "en": "Not saved, because the project changed",
    "es": "No se guardó porque el proyecto cambió",
    "fr": "Non enregistré, parce que le projet a changé",
    "zh": "项目已切换，因此没有保存"
  },
  "保存しました": {
    "en": "Saved",
    "es": "Guardado",
    "fr": "Enregistré",
    "zh": "已保存"
  },
  "<span>名前（{v1}文字まで）</span>": {
    "en": "<span>Name (up to {v1} characters)</span>",
    "es": "<span>Nombre (hasta {v1} caracteres)</span>",
    "fr": "<span>Nom ({v1} caractères au plus)</span>",
    "zh": "<span>名称（最多 {v1} 个字符）</span>"
  },
  "フローチャートを保存しています…": {
    "en": "Saving the flowchart…",
    "es": "Guardando el diagrama…",
    "fr": "Enregistrement de l’organigramme…",
    "zh": "正在保存流程图…"
  },
  "エクスポートしました{v1}": {
    "en": "Exported{v1}",
    "es": "Exportado{v1}",
    "fr": "Exporté{v1}",
    "zh": "已导出{v1}"
  },
  "（カスタムエージェントの工程があります。ほかのプロジェクトで使うときは「まとめてエクスポート」で一緒に書き出してください）": {
    "en": " (A step uses a custom agent. To use it in another project, export it together with “Export together”.)",
    "es": " (Hay un paso con agente personalizado. Para usarlo en otro proyecto, expórtalo junto con «Exportar juntos».)",
    "fr": " (Une étape utilise un agent personnalisé. Pour l’utiliser dans un autre projet, exportez-le avec « Exporter ensemble ».)",
    "zh": "（有使用自定义智能体的工序。要在其他项目使用时，请用「一起导出」一并写出。）"
  },
  "<span>カスタムエージェント</span>": {
    "en": "<span>Custom agents</span>",
    "es": "<span>Agentes personalizados</span>",
    "fr": "<span>Agents personnalisés</span>",
    "zh": "<span>自定义智能体</span>"
  },
  " <span class=\"muted small\">（工程で使用）</span>": {
    "en": " <span class=\"muted small\">(used by a step)</span>",
    "es": " <span class=\"muted small\">(usado en un paso)</span>",
    "fr": " <span class=\"muted small\">(utilisé par une étape)</span>",
    "zh": " <span class=\"muted small\">（工序中使用）</span>"
  },
  "<span class=\"muted small\">まだありません</span>": {
    "en": "<span class=\"muted small\">None yet</span>",
    "es": "<span class=\"muted small\">Todavía no hay</span>",
    "fr": "<span class=\"muted small\">Aucun pour l’instant</span>",
    "zh": "<span class=\"muted small\">还没有</span>"
  },
  "{v1}工程で使っているカスタムエージェントを外すと、取り込んだ先でその工程のエージェントを選び直すことになります": {
    "en": "{v1}If you leave out a custom agent used by a step, that step’s agent will have to be chosen again after import",
    "es": "{v1}Si quitas un agente personalizado que usa un paso, al importar habrá que volver a elegir el agente de ese paso",
    "fr": "{v1}Si vous retirez un agent personnalisé utilisé par une étape, il faudra choisir à nouveau l’agent de cette étape après l’import",
    "zh": "{v1}如果去掉工序正在使用的自定义智能体，导入后必须重新选择该工序的智能体"
  },
  "zip でエクスポート": {
    "en": "Export as zip",
    "es": "Exportar en zip",
    "fr": "Exporter en zip",
    "zh": "导出为 zip"
  },
  "エクスポートするものを選んでください": {
    "en": "Choose something to export",
    "es": "Elige qué exportar",
    "fr": "Choisissez ce qu’il faut exporter",
    "zh": "请选择要导出的内容"
  },
  "Pipeline {v1} 個・カスタムエージェント {v2} 個をエクスポートしました": {
    "en": "Exported {v1} Pipeline(s) and {v2} custom agent(s)",
    "es": "Se exportaron {v1} Pipeline y {v2} agentes personalizados",
    "fr": "{v1} Pipeline et {v2} agents personnalisés ont été exportés",
    "zh": "已导出 {v1} 个 Pipeline、{v2} 个自定义智能体"
  },
  "「{v1}」から取り込みます。": {
    "en": "Importing from “{v1}”.",
    "es": "Se importará desde «{v1}».",
    "fr": "Import depuis « {v1} ».",
    "zh": "将从「{v1}」导入。"
  },
  "カスタムエージェント（追加）: {v1}": {
    "en": "Custom agents (added): {v1}",
    "es": "Agentes personalizados (añadidos): {v1}",
    "fr": "Agents personnalisés (ajoutés) : {v1}",
    "zh": "自定义智能体（添加）：{v1}"
  },
  "、": {
    "en": ", ",
    "es": ", ",
    "fr": ", ",
    "zh": "、"
  },
  "カスタムエージェント（同じものがあるので、それを使う）: {v1}": {
    "en": "Custom agents (an identical one exists, so it will be used): {v1}",
    "es": "Agentes personalizados (ya hay uno igual, así que se usará): {v1}",
    "fr": "Agents personnalisés (un identique existe, il sera utilisé) : {v1}",
    "zh": "自定义智能体（已有相同的，因此使用它）：{v1}"
  },
  "カスタムエージェントが見つからない工程があります（取り込んだあと、フローチャートで選び直してください）: {v1}": {
    "en": "Some steps refer to a custom agent that was not found (choose it again on the flowchart after import): {v1}",
    "es": "Hay pasos cuyo agente personalizado no se encuentra (después de importar, elígelo de nuevo en el diagrama): {v1}",
    "fr": "Des étapes référencent un agent personnalisé introuvable (après l’import, choisissez-le à nouveau dans l’organigramme) : {v1}",
    "zh": "有的工序找不到自定义智能体（导入后请在流程图里重新选择）：{v1}"
  },
  "読めなかったファイル: {v1}": {
    "en": "Files that could not be read: {v1}",
    "es": "Archivos que no se pudieron leer: {v1}",
    "fr": "Fichiers illisibles : {v1}",
    "zh": "无法读取的文件：{v1}"
  },
  "取り込むものはありません（同じカスタムエージェントがもうあります）": {
    "en": "Nothing to import (the same custom agent is already here)",
    "es": "No hay nada que importar (ese agente personalizado ya existe)",
    "fr": "Rien à importer (le même agent personnalisé est déjà là)",
    "zh": "没有可导入的内容（相同的自定义智能体已经存在）"
  },
  "取り込んでいます…": {
    "en": "Importing…",
    "es": "Importando…",
    "fr": "Import…",
    "zh": "正在导入…"
  },
  " <span class=\"pl-badge\">既定</span>": {
    "en": " <span class=\"pl-badge\">Default</span>",
    "es": " <span class=\"pl-badge\">Predeterminado</span>",
    "fr": " <span class=\"pl-badge\">Par défaut</span>",
    "zh": " <span class=\"pl-badge\">默认</span>"
  },
  "フローチャートを編集": {
    "en": "Edit flowchart",
    "es": "Editar diagrama",
    "fr": "Modifier l’organigramme",
    "zh": "编辑流程图"
  },
  "名前": {
    "en": "Name",
    "es": "Nombre",
    "fr": "Nom",
    "zh": "名称"
  },
  "複製": {
    "en": "Duplicate",
    "es": "Duplicar",
    "fr": "Dupliquer",
    "zh": "复制"
  },
  "既定にする": {
    "en": "Make default",
    "es": "Hacer predeterminado",
    "fr": "Définir par défaut",
    "zh": "设为默认"
  },
  "エクスポート": {
    "en": "Export",
    "es": "Exportar",
    "fr": "Exporter",
    "zh": "导出"
  },
  "この Pipeline と、工程で使うカスタムエージェントを zip にします": {
    "en": "Put this Pipeline and the custom agents used by its steps into a zip",
    "es": "Mete este Pipeline y los agentes personalizados de sus pasos en un zip",
    "fr": "Met ce Pipeline et les agents personnalisés utilisés par ses étapes dans un zip",
    "zh": "把这个 Pipeline 和工序使用的自定义智能体打成 zip"
  },
  "「{v1}」の名前を変える": {
    "en": "Rename “{v1}”",
    "es": "Cambiar el nombre de «{v1}»",
    "fr": "Renommer « {v1} »",
    "zh": "更改「{v1}」的名称"
  },
  "「{v1}」という名前の Pipeline はもうあります": {
    "en": "A Pipeline named “{v1}” already exists",
    "es": "Ya hay un Pipeline llamado «{v1}»",
    "fr": "Un Pipeline nommé « {v1} » existe déjà",
    "zh": "已经有名为「{v1}」的 Pipeline"
  },
  "名前を変えています…": {
    "en": "Renaming…",
    "es": "Cambiando el nombre…",
    "fr": "Changement du nom…",
    "zh": "正在更改名称…"
  },
  "{v1} のコピー": {
    "en": "Copy of {v1}",
    "es": "Copia de {v1}",
    "fr": "Copie de {v1}",
    "zh": "{v1} 的副本"
  },
  "複製しています…": {
    "en": "Duplicating…",
    "es": "Duplicando…",
    "fr": "Duplication…",
    "zh": "正在复制…"
  },
  "既定の Pipeline を変えています…": {
    "en": "Changing the default Pipeline…",
    "es": "Cambiando el Pipeline predeterminado…",
    "fr": "Changement du Pipeline par défaut…",
    "zh": "正在更改默认 Pipeline…"
  },
  "Pipeline「{v1}」を削除しますか？\n（作ってあるタスクは、そのまま動きます）": {
    "en": "Delete the Pipeline “{v1}”?\n(Tasks already created keep running as they are)",
    "es": "¿Eliminar el Pipeline «{v1}»?\n(Las tareas ya creadas siguen igual)",
    "fr": "Supprimer le Pipeline « {v1} » ?\n(Les tâches déjà créées continuent telles quelles)",
    "zh": "要删除 Pipeline「{v1}」吗？\n（已经创建的任务会照常运行）"
  },
  "削除しています…": {
    "en": "Deleting…",
    "es": "Eliminando…",
    "fr": "Suppression…",
    "zh": "正在删除…"
  },
  "Pipelineを追加": {
    "en": "Add a Pipeline",
    "es": "Añadir un Pipeline",
    "fr": "Ajouter un Pipeline",
    "zh": "添加 Pipeline"
  },
  "追加してフローチャートを編集": {
    "en": "Add and edit the flowchart",
    "es": "Añadir y editar el diagrama",
    "fr": "Ajouter et modifier l’organigramme",
    "zh": "添加并编辑流程图"
  },
  "Pipeline を追加しています…": {
    "en": "Adding the Pipeline…",
    "es": "Añadiendo el Pipeline…",
    "fr": "Ajout du Pipeline…",
    "zh": "正在添加 Pipeline…"
  },
  "保存済みの値に戻しました": {
    "en": "Reverted to the saved values",
    "es": "Se volvió a los valores guardados",
    "fr": "Retour aux valeurs enregistrées",
    "zh": "已恢复为已保存的值"
  },
  "使うエージェントを1つ以上選んでください": {
    "en": "Choose at least one agent to use",
    "es": "Elige al menos un agente",
    "fr": "Choisissez au moins un agent",
    "zh": "请至少选择一个要使用的智能体"
  },
  "カスタムエージェントの編集を決定していません。編集中の内容を捨てて保存しますか？": {
    "en": "The custom agent edits are not confirmed. Discard them and save?",
    "es": "No confirmaste la edición del agente personalizado. ¿Descartarla y guardar?",
    "fr": "Les modifications de l’agent personnalisé ne sont pas validées. Les abandonner et enregistrer ?",
    "zh": "自定义智能体的编辑还没有确定。要放弃正在编辑的内容并保存吗？"
  },
  "（名前なし）": {
    "en": "(untitled)",
    "es": "(sin nombre)",
    "fr": "(sans nom)",
    "zh": "（未命名）"
  },
  "Pipelineの工程「{v1}」のカスタムエージェントがありません。このままだとPipelineを始められません。保存しますか？": {
    "en": "The Pipeline step “{v1}” has no custom agent. The Pipeline cannot start like this. Save anyway?",
    "es": "El paso «{v1}» del Pipeline no tiene agente personalizado. Así no se puede empezar el Pipeline. ¿Guardar igualmente?",
    "fr": "L’étape « {v1} » du Pipeline n’a pas d’agent personnalisé. Le Pipeline ne pourra pas démarrer. Enregistrer quand même ?",
    "zh": "Pipeline 的工序「{v1}」没有自定义智能体。这样无法开始 Pipeline。仍要保存吗？"
  },
  "Pipelineの工程「{v1}」の {v2} は使わない設定です。このままだとPipelineを始められません。保存しますか？": {
    "en": "The Pipeline step “{v1}” uses {v2}, which is not enabled. The Pipeline cannot start like this. Save anyway?",
    "es": "El paso «{v1}» del Pipeline usa {v2}, que no está activado. Así no se puede empezar el Pipeline. ¿Guardar igualmente?",
    "fr": "L’étape « {v1} » du Pipeline utilise {v2}, qui n’est pas activé. Le Pipeline ne pourra pas démarrer. Enregistrer quand même ?",
    "zh": "Pipeline 的工序「{v1}」的 {v2} 被设为不使用。这样无法开始 Pipeline。仍要保存吗？"
  },
  "設定を保存しています…": {
    "en": "Saving settings…",
    "es": "Guardando los ajustes…",
    "fr": "Enregistrement des réglages…",
    "zh": "正在保存设置…"
  },
  "<b>ブラウザで GitHub にログインしてください</b>": {
    "en": "<b>Sign in to GitHub in the browser</b>",
    "es": "<b>Inicia sesión en GitHub en el navegador</b>",
    "fr": "<b>Connectez-vous à GitHub dans le navigateur</b>",
    "zh": "<b>请在浏览器中登录 GitHub</b>"
  },
  "開いたページに、次のコードを入力します。": {
    "en": "Enter the following code on the page that opened.",
    "es": "Introduce el código siguiente en la página que se abrió.",
    "fr": "Saisissez le code suivant sur la page qui s’est ouverte.",
    "zh": "在打开的页面中输入下面的代码。"
  },
  "ページを開く": {
    "en": "Open page",
    "es": "Abrir la página",
    "fr": "Ouvrir la page",
    "zh": "打开页面"
  },
  "ログインが終わると、自動でこの画面に戻ります。": {
    "en": "When sign-in finishes, this screen updates on its own.",
    "es": "Cuando termine el inicio de sesión, esta pantalla se actualiza sola.",
    "fr": "Une fois la connexion terminée, cet écran se met à jour tout seul.",
    "zh": "登录结束后，这个画面会自动回来。"
  },
  "<b>処理しています…</b>{v1}": {
    "en": "<b>Working…</b>{v1}",
    "es": "<b>Procesando…</b>{v1}",
    "fr": "<b>Traitement…</b>{v1}",
    "zh": "<b>正在处理…</b>{v1}"
  },
  "gh の状態を確認できませんでした": {
    "en": "Could not check gh",
    "es": "No se pudo comprobar gh",
    "fr": "Impossible de vérifier gh",
    "zh": "无法确认 gh 的状态"
  },
  "<b>gh（GitHub CLI）が入っていません</b>": {
    "en": "<b>gh (GitHub CLI) is not installed</b>",
    "es": "<b>gh (GitHub CLI) no está instalado</b>",
    "fr": "<b>gh (GitHub CLI) n’est pas installé</b>",
    "zh": "<b>尚未安装 gh（GitHub CLI）</b>"
  },
  "Issue を読み込むのに使います（private リポジトリの Issue も読めるようになります）。": {
    "en": "It is used to read Issues (including Issues in private repositories).",
    "es": "Sirve para leer Issues (también los de repositorios privados).",
    "fr": "Il sert à lire les Issues (y compris celles des dépôts privés).",
    "zh": "用来读取 Issue（私有仓库的 Issue 也可以读）。"
  },
  "gh をインストールする": {
    "en": "Install gh",
    "es": "Instalar gh",
    "fr": "Installer gh",
    "zh": "安装 gh"
  },
  "<span class=\"muted small\">{v1} で <code>{v2}</code> を実行します</span>": {
    "en": "<span class=\"muted small\">Runs <code>{v2}</code> with {v1}</span>",
    "es": "<span class=\"muted small\">Ejecuta <code>{v2}</code> con {v1}</span>",
    "fr": "<span class=\"muted small\">Exécute <code>{v2}</code> avec {v1}</span>",
    "zh": "<span class=\"muted small\">用 {v1} 运行 <code>{v2}</code></span>"
  },
  "ダウンロードページを開く": {
    "en": "Open the download page",
    "es": "Abrir la página de descarga",
    "fr": "Ouvrir la page de téléchargement",
    "zh": "打开下载页面"
  },
  "<span class=\"muted small\">インストールしたら「もう一度確認」を押してください</span>": {
    "en": "<span class=\"muted small\">After installing, press “Check again”</span>",
    "es": "<span class=\"muted small\">Cuando lo instales, pulsa «Comprobar otra vez»</span>",
    "fr": "<span class=\"muted small\">Après l’installation, appuyez sur « Vérifier à nouveau »</span>",
    "zh": "<span class=\"muted small\">安装后请按「再确认一次」</span>"
  },
  "もう一度確認": {
    "en": "Check again",
    "es": "Comprobar otra vez",
    "fr": "Vérifier à nouveau",
    "zh": "再确认一次"
  },
  "public リポジトリなら、gh がなくても読み込めます。": {
    "en": "Public repositories can still be read without gh.",
    "es": "Los repositorios públicos se pueden leer aunque no haya gh.",
    "fr": "Les dépôts publics restent lisibles sans gh.",
    "zh": "公开仓库即使没有 gh 也能读取。"
  },
  "<b>gh は入っていますが、GitHub にログインしていません</b>": {
    "en": "<b>gh is installed, but you are not signed in to GitHub</b>",
    "es": "<b>gh está instalado, pero no has iniciado sesión en GitHub</b>",
    "fr": "<b>gh est installé, mais vous n’êtes pas connecté à GitHub</b>",
    "zh": "<b>已安装 gh，但还没有登录 GitHub</b>"
  },
  "GitHub にログイン": {
    "en": "Sign in to GitHub",
    "es": "Iniciar sesión en GitHub",
    "fr": "Se connecter à GitHub",
    "zh": "登录 GitHub"
  },
  "<span class=\"muted small\">ブラウザが開くので、表示されたコードを入力します</span>": {
    "en": "<span class=\"muted small\">A browser opens; enter the code it shows</span>",
    "es": "<span class=\"muted small\">Se abre el navegador; introduce el código que muestra</span>",
    "fr": "<span class=\"muted small\">Le navigateur s’ouvre ; saisissez le code affiché</span>",
    "zh": "<span class=\"muted small\">会打开浏览器，请输入显示的代码</span>"
  },
  "<span>{v1}gh で GitHub にログインしています{v2}</span>": {
    "en": "<span>{v1}Signed in to GitHub with gh{v2}</span>",
    "es": "<span>{v1}Sesión iniciada en GitHub con gh{v2}</span>",
    "fr": "<span>{v1}Connecté à GitHub avec gh{v2}</span>",
    "zh": "<span>{v1}已用 gh 登录 GitHub{v2}</span>"
  },
  "（<b>{v1}</b>）": {
    "en": " (<b>{v1}</b>)",
    "es": " (<b>{v1}</b>)",
    "fr": " (<b>{v1}</b>)",
    "zh": "（<b>{v1}</b>）"
  },
  "Issue のステータス（GitHub Projects の In progress / In review / Done）を自動で変えるには、project の権限が必要です。": {
    "en": "Changing Issue status (GitHub Projects: In progress / In review / Done) requires the project scope.",
    "es": "Para cambiar el estado del Issue (In progress / In review / Done en GitHub Projects) hace falta el permiso project.",
    "fr": "Changer le statut de l’Issue (In progress / In review / Done dans GitHub Projects) exige le droit project.",
    "zh": "要自动更改 Issue 的状态（GitHub Projects 的 In progress / In review / Done），需要 project 权限。"
  },
  "Projects の権限を追加": {
    "en": "Add the Projects scope",
    "es": "Añadir el permiso de Projects",
    "fr": "Ajouter le droit Projects",
    "zh": "添加 Projects 权限"
  },
  "gh をインストールしました": {
    "en": "gh was installed",
    "es": "gh se instaló",
    "fr": "gh a été installé",
    "zh": "已安装 gh"
  },
  "project の権限を追加しました": {
    "en": "The project scope was added",
    "es": "Se añadió el permiso project",
    "fr": "Le droit project a été ajouté",
    "zh": "已添加 project 权限"
  },
  "GitHub にログインしました": {
    "en": "Signed in to GitHub",
    "es": "Sesión iniciada en GitHub",
    "fr": "Connecté à GitHub",
    "zh": "已登录 GitHub"
  },
  "続けて「GitHub にログイン」を押してください": {
    "en": "Next, press “Sign in to GitHub”",
    "es": "Después, pulsa «Iniciar sesión en GitHub»",
    "fr": "Ensuite, appuyez sur « Se connecter à GitHub »",
    "zh": "请接着按「登录 GitHub」"
  },
  "<p class=\"muted\">新しい版を確かめています…</p>": {
    "en": "<p class=\"muted\">Checking for a new version…</p>",
    "es": "<p class=\"muted\">Comprobando si hay una versión nueva…</p>",
    "fr": "<p class=\"muted\">Recherche d’une nouvelle version…</p>",
    "zh": "<p class=\"muted\">正在查看有没有新版本…</p>"
  },
  "今の版: <b>v{v1}</b>": {
    "en": "This version: <b>v{v1}</b>",
    "es": "Versión actual: <b>v{v1}</b>",
    "fr": "Version actuelle : <b>v{v1}</b>",
    "zh": "当前版本：<b>v{v1}</b>"
  },
  "（{v1} に確かめました）": {
    "en": " (checked at {v1})",
    "es": " (comprobado el {v1})",
    "fr": " (vérifié le {v1})",
    "zh": "（于 {v1} 确认）"
  },
  "v{v1} に更新しています。アプリを終了して入れ替え、起動し直します…": {
    "en": "Updating to v{v1}. The app will quit, be replaced, and start again…",
    "es": "Actualizando a v{v1}. La aplicación se cerrará, se sustituirá y volverá a abrirse…",
    "fr": "Mise à jour vers v{v1}. L’application va quitter, être remplacée et redémarrer…",
    "zh": "正在更新到 v{v1}。应用会退出、替换后再启动…"
  },
  "<b>新しい版 v{v1} があります。</b> <a href=\"#\" id=\"updNotes\">変更点を見る</a>": {
    "en": "<b>A new version v{v1} is available.</b> <a href=\"#\" id=\"updNotes\">See what changed</a>",
    "es": "<b>Hay una versión nueva, v{v1}.</b> <a href=\"#\" id=\"updNotes\">Ver los cambios</a>",
    "fr": "<b>Une nouvelle version v{v1} est disponible.</b> <a href=\"#\" id=\"updNotes\">Voir les changements</a>",
    "zh": "<b>有新版本 v{v1}。</b> <a href=\"#\" id=\"updNotes\">查看变更</a>"
  },
  "新しいバージョンに更新": {
    "en": "Update to the new version",
    "es": "Actualizar a la versión nueva",
    "fr": "Mettre à jour vers la nouvelle version",
    "zh": "更新到新版本"
  },
  "新しい版 v{v1} を準備中です（この OS 向けのファイルがまだそろっていません）。しばらくしてからもう一度確かめてください。": {
    "en": "Version v{v1} is still being prepared (the file for this OS is not ready yet). Check again in a little while.",
    "es": "La versión v{v1} se está preparando (aún no está el archivo para este sistema). Vuelve a comprobarlo dentro de un rato.",
    "fr": "La version v{v1} est en préparation (le fichier pour cet OS n’est pas encore prêt). Vérifiez à nouveau un peu plus tard.",
    "zh": "新版本 v{v1} 还在准备中（这个系统的文件还没齐）。请过一会儿再查看。"
  },
  "最新の版です{v1}": {
    "en": "You are on the latest version{v1}",
    "es": "Estás en la última versión{v1}",
    "fr": "Vous avez la dernière version{v1}",
    "zh": "已是最新版本{v1}"
  },
  "<p class=\"upd-warn\">前回の更新はできませんでした。<a href=\"#\" id=\"updLog\">更新の記録を開く</a></p>": {
    "en": "<p class=\"upd-warn\">The last update failed. <a href=\"#\" id=\"updLog\">Open the update log</a></p>",
    "es": "<p class=\"upd-warn\">La última actualización no se pudo hacer. <a href=\"#\" id=\"updLog\">Abrir el registro de la actualización</a></p>",
    "fr": "<p class=\"upd-warn\">La dernière mise à jour a échoué. <a href=\"#\" id=\"updLog\">Ouvrir le journal de mise à jour</a></p>",
    "zh": "<p class=\"upd-warn\">上次更新没有成功。<a href=\"#\" id=\"updLog\">打开更新记录</a></p>"
  },
  "新しい版を確かめる": {
    "en": "Check for a new version",
    "es": "Comprobar si hay una versión nueva",
    "fr": "Chercher une nouvelle version",
    "zh": "查看有没有新版本"
  },
  "新しい版が出たら自動で更新する": {
    "en": "Update automatically when a new version is released",
    "es": "Actualizar automáticamente cuando salga una versión nueva",
    "fr": "Mettre à jour automatiquement quand une nouvelle version sort",
    "zh": "有新版本时自动更新"
  },
  "アプリは起動したときと6時間ごとに新しい版を確かめます。自動で更新するときは、実行中・待機中のタスクがなくなるのを待ってから、アプリを終了して入れ替え、起動し直します。更新すると、手で入れたときと同じ場所（{v1}）に入ります。": {
    "en": "The app checks for a new version at startup and every 6 hours. An automatic update waits until no task is running or queued, then quits, replaces the app, and starts again. The new version is installed in the same place as a manual install ({v1}).",
    "es": "La aplicación comprueba si hay una versión nueva al arrancar y cada 6 horas. La actualización automática espera a que no haya tareas en ejecución ni en espera, luego cierra, sustituye la aplicación y la vuelve a abrir. Queda en el mismo sitio que una instalación manual ({v1}).",
    "fr": "L’application cherche une nouvelle version au démarrage et toutes les 6 heures. La mise à jour automatique attend qu’aucune tâche ne soit en cours ou en attente, puis quitte, remplace l’application et la relance. Elle s’installe au même endroit qu’une installation manuelle ({v1}).",
    "zh": "应用会在启动时以及每 6 小时查看一次有没有新版本。自动更新会等到没有正在执行或等待中的任务，然后退出、替换并重新启动。更新后会装到和手动安装相同的位置（{v1}）。"
  },
  "/Applications または ~/.local/bin": {
    "en": "/Applications or ~/.local/bin",
    "es": "/Applications o ~/.local/bin",
    "fr": "/Applications ou ~/.local/bin",
    "zh": "/Applications 或 ~/.local/bin"
  },
  "新しい版が出たら自動で更新します": {
    "en": "New versions will be installed automatically",
    "es": "Las versiones nuevas se instalarán automáticamente",
    "fr": "Les nouvelles versions seront installées automatiquement",
    "zh": "有新版本时会自动更新"
  },
  "自動で更新しないようにしました": {
    "en": "Automatic updates are off",
    "es": "Las actualizaciones automáticas están desactivadas",
    "fr": "Les mises à jour automatiques sont désactivées",
    "zh": "已改为不自动更新"
  },
  "{v1}のタスクは中断します（それまでの変更はタスクのブランチにコミットし、起動し直したあとに「再開」で続けられます）。": {
    "en": "{v1} will be interrupted (changes so far are committed on the task branch, and you can continue with “Resume” after the app starts again).",
    "es": "{v1} se interrumpirán (los cambios hechos hasta ahora se confirman en la rama de la tarea y, al volver a abrir, se pueden seguir con «Reanudar»).",
    "fr": "{v1} seront interrompues (les changements déjà faits sont validés sur la branche de la tâche, et vous pourrez continuer avec « Reprendre » après le redémarrage).",
    "zh": "{v1}的任务会中断（到目前为止的更改会提交到任务分支，重新启动后可以用「继续」接着做）。"
  },
  "実行中 {v1} 件": {
    "en": "{v1} running",
    "es": "{v1} en ejecución",
    "fr": "{v1} en cours",
    "zh": "执行中 {v1} 件"
  },
  "待機中 {v1} 件": {
    "en": "{v1} queued",
    "es": "{v1} en espera",
    "fr": "{v1} en attente",
    "zh": "等待中 {v1} 件"
  },
  "v{v1} に更新します。アプリを終了して新しい版に入れ替え、起動し直します（1分ほどかかります）。{v2}\n\n更新しますか？": {
    "en": "Update to v{v1}. The app will quit, be replaced with the new version, and start again (about a minute).{v2}\n\nUpdate now?",
    "es": "Actualizar a v{v1}. La aplicación se cerrará, se sustituirá por la versión nueva y volverá a abrirse (tarda cerca de un minuto).{v2}\n\n¿Actualizar?",
    "fr": "Mettre à jour vers v{v1}. L’application va quitter, être remplacée par la nouvelle version et redémarrer (environ une minute).{v2}\n\nMettre à jour ?",
    "zh": "将更新到 v{v1}。应用会退出、换成新版本后再启动（大约需要 1 分钟）。{v2}\n\n要更新吗？"
  },
  "更新しています…": {
    "en": "Updating…",
    "es": "Actualizando…",
    "fr": "Mise à jour…",
    "zh": "正在更新…"
  },
  "v{v1} に更新できます": {
    "en": "v{v1} can be installed",
    "es": "Se puede actualizar a v{v1}",
    "fr": "v{v1} peut être installée",
    "zh": "可以更新到 v{v1}"
  },
  "v{v1} に更新しました": {
    "en": "Updated to v{v1}",
    "es": "Actualizado a v{v1}",
    "fr": "Mis à jour vers v{v1}",
    "zh": "已更新到 v{v1}"
  },
  "v{v1} に更新できませんでした（v{v2} のままです）。詳しくは設定の「アプリの更新」から記録を開いて確かめてください": {
    "en": "Could not update to v{v1} (still on v{v2}). Open the log from Settings → “App updates” to see why",
    "es": "No se pudo actualizar a v{v1} (sigue en v{v2}). Abre el registro desde Ajustes → «Actualización de la aplicación» para ver el detalle",
    "fr": "Impossible de mettre à jour vers v{v1} (toujours en v{v2}). Ouvrez le journal dans Réglages → « Mises à jour de l’application » pour en savoir plus",
    "zh": "无法更新到 v{v1}（仍是 v{v2}）。详情请从设置的「应用更新」打开记录查看"
  },
  "（開発版）": {
    "en": " (dev build)",
    "es": " (versión de desarrollo)",
    "fr": " (version de développement)",
    "zh": "（开发版）"
  },
  "全般": {
    "en": "General",
    "es": "General",
    "fr": "Général",
    "zh": "常规"
  },
  "アプリの更新": {
    "en": "App updates",
    "es": "Actualización de la aplicación",
    "fr": "Mises à jour de l’application",
    "zh": "应用更新"
  },
  "このプロジェクト": {
    "en": "This project",
    "es": "Este proyecto",
    "fr": "Ce projet",
    "zh": "此项目"
  },
  "ブランチと取り込み": {
    "en": "Branches and landing",
    "es": "Ramas e integración",
    "fr": "Branches et intégration",
    "zh": "分支与并入"
  },
  "Issue 連携": {
    "en": "Issue sync",
    "es": "Enlace con Issues",
    "fr": "Lien avec les Issues",
    "zh": "Issue 联动"
  },
  "権限": {
    "en": "Permissions",
    "es": "Permisos",
    "fr": "Autorisations",
    "zh": "权限"
  },
  "タスクの既定": {
    "en": "Task defaults",
    "es": "Valores de las tareas",
    "fr": "Réglages par défaut des tâches",
    "zh": "任务的默认"
  },
  "エージェント": {
    "en": "Agents",
    "es": "Agentes",
    "fr": "Agents",
    "zh": "智能体"
  },
  "使うエージェント": {
    "en": "Agents to use",
    "es": "Agentes en uso",
    "fr": "Agents utilisés",
    "zh": "使用的智能体"
  },
  "<b>{v1}</b> を使う": {
    "en": "Use <b>{v1}</b>",
    "es": "Usar <b>{v1}</b>",
    "fr": "Utiliser <b>{v1}</b>",
    "zh": "使用 <b>{v1}</b>"
  },
  "カスタムエージェント": {
    "en": "Custom agents",
    "es": "Agentes personalizados",
    "fr": "Agents personnalisés",
    "zh": "自定义智能体"
  },
  "オーケストレーション": {
    "en": "Orchestration",
    "es": "Orquestación",
    "fr": "Orchestration",
    "zh": "编排"
  },
  "拡大・縮小": {
    "en": "Zoom",
    "es": "Zoom",
    "fr": "Zoom",
    "zh": "缩放"
  },
  "縮小（⌘ / Ctrl ＋ スクロールでも変えられます）": {
    "en": "Zoom out (also ⌘ / Ctrl + scroll)",
    "es": "Reducir (también ⌘ / Ctrl + desplazamiento)",
    "fr": "Réduire (aussi ⌘ / Ctrl + défilement)",
    "zh": "缩小（也可以用 ⌘ / Ctrl ＋ 滚动）"
  },
  "100% に戻す": {
    "en": "Back to 100%",
    "es": "Volver al 100 %",
    "fr": "Revenir à 100 %",
    "zh": "回到 100%"
  },
  "拡大（⌘ / Ctrl ＋ スクロールでも変えられます）": {
    "en": "Zoom in (also ⌘ / Ctrl + scroll)",
    "es": "Ampliar (también ⌘ / Ctrl + desplazamiento)",
    "fr": "Agrandir (aussi ⌘ / Ctrl + défilement)",
    "zh": "放大（也可以用 ⌘ / Ctrl ＋ 滚动）"
  },
  "全体が見える大きさにする": {
    "en": "Fit everything in view",
    "es": "Verlo todo",
    "fr": "Tout faire tenir",
    "zh": "缩放到能看到全部"
  },
  "全体": {
    "en": "Fit",
    "es": "Todo",
    "fr": "Tout",
    "zh": "全部"
  },
  "画面を切り替えます": {
    "en": "Switch screens",
    "es": "Cambiar de pantalla",
    "fr": "Changer d’écran",
    "zh": "切换画面"
  },
  "メニュー": {
    "en": "Menu",
    "es": "Menú",
    "fr": "Menu",
    "zh": "菜单"
  },
  "画面の切り替え": {
    "en": "Screen switcher",
    "es": "Cambio de pantalla",
    "fr": "Changement d’écran",
    "zh": "画面切换"
  },
  "設定の「アプリの更新」を開きます": {
    "en": "Open “App updates” in Settings",
    "es": "Abrir «Actualización de la aplicación» en Ajustes",
    "fr": "Ouvrir « Mises à jour de l’application » dans les réglages",
    "zh": "打开设置中的「应用更新」"
  },
  "開いているリポジトリ": {
    "en": "Open repositories",
    "es": "Repositorios abiertos",
    "fr": "Dépôts ouverts",
    "zh": "打开的仓库"
  },
  "遠隔操作の状態": {
    "en": "Remote control status",
    "es": "Estado del control remoto",
    "fr": "État du contrôle à distance",
    "zh": "远程控制状态"
  },
  "遠隔操作（RC）: ホストの開始・別の PC への接続・SSH の鍵": {
    "en": "Remote control (RC): start a host, connect to another PC, SSH keys",
    "es": "Control remoto (RC): iniciar un host, conectar a otro PC, claves SSH",
    "fr": "Contrôle à distance (RC) : démarrer un hôte, se connecter à un autre PC, clés SSH",
    "zh": "远程控制（RC）：启动主机、连接到另一台电脑、SSH 密钥"
  },
  "Claude Code の会話（セッション）を一覧して消します（タスクとは別に管理できます）": {
    "en": "List and delete Claude Code conversations (sessions). They are kept apart from tasks",
    "es": "Lista y borra conversaciones de Claude Code (sesiones). Se gestionan aparte de las tareas",
    "fr": "Lister et supprimer les conversations Claude Code (sessions). Elles sont gérées à part des tâches",
    "zh": "列出并删除 Claude Code 的对话（会话）。可以与任务分开管理"
  },
  "タスクを作らずに、このリポジトリについてエージェントと話します": {
    "en": "Talk with an agent about this repository without creating a task",
    "es": "Habla con un agente sobre este repositorio sin crear una tarea",
    "fr": "Parler avec un agent de ce dépôt sans créer de tâche",
    "zh": "不创建任务，直接和智能体谈论这个仓库"
  },
  "新しいタスク": {
    "en": "New task",
    "es": "Nueva tarea",
    "fr": "Nouvelle tâche",
    "zh": "新建任务"
  },
  "通知": {
    "en": "Notifications",
    "es": "Notificaciones",
    "fr": "Notifications",
    "zh": "通知"
  },
  "ドラッグで幅を変えられます（ダブルクリックで元の幅に戻します）": {
    "en": "Drag to change the width (double-click to restore)",
    "es": "Arrastra para cambiar el ancho (doble clic para volver al original)",
    "fr": "Faites glisser pour changer la largeur (double-clic pour revenir à la largeur d’origine)",
    "zh": "拖动可改变宽度（双击恢复原来的宽度）"
  },
  "指示や質問と、それに対するエージェントの最後の返事だけを見ます（ツールの結果などは「ログ」で見られます）": {
    "en": "Shows only your prompts and the agent’s last reply (tool results are in “Log”)",
    "es": "Muestra solo las indicaciones y la última respuesta del agente (los resultados de las herramientas están en «Registro»)",
    "fr": "Affiche seulement les consignes et la dernière réponse de l’agent (les résultats d’outils sont dans « Journal »)",
    "zh": "只看指示、提问和智能体的最后一次回复（工具结果等请在「日志」里看）"
  },
  "worktree の作業状況（コミット・未コミットの変更・ベースとの関係）を見ます": {
    "en": "Shows the worktree (commits, uncommitted changes, and how it relates to the base)",
    "es": "Muestra el worktree (commits, cambios sin confirmar y la relación con la base)",
    "fr": "Affiche le worktree (commits, changements non validés et le rapport avec la base)",
    "zh": "查看 worktree 的工作情况（提交、未提交的更改、与基础分支的关系）"
  },
  "全体の進み具合（エージェントの TODO・Pipelineのどの工程まで終わったか・サブタスクがいくつ終わったか）を見ます": {
    "en": "Shows overall progress (the agent’s TODOs, which Pipeline step finished, and how many subtasks are done)",
    "es": "Muestra el avance general (los TODO del agente, hasta qué paso del Pipeline se llegó y cuántos subtasks terminaron)",
    "fr": "Affiche l’avancement global (les TODO de l’agent, l’étape Pipeline atteinte et le nombre de sous-tâches terminées)",
    "zh": "查看整体进度（智能体的 TODO、Pipeline 进行到哪一道工序、子任务完成了多少）"
  },
  "サブタスクごとの状態を見ます。開始・取り込み・状態の変更もここでできます": {
    "en": "Shows each subtask. You can start them, take them in, and change their state here",
    "es": "Muestra el estado de cada subtask. Aquí puedes iniciarlos, incorporarlos y cambiar su estado",
    "fr": "Affiche l’état de chaque sous-tâche. Vous pouvez les démarrer, les intégrer et changer leur état ici",
    "zh": "查看每个子任务的状态。也可以在这里开始、并入和更改状态"
  },
  "実行中のエージェントに、作業を止めずにメッセージを送ります": {
    "en": "Send a message to the running agent without stopping the work",
    "es": "Envía un mensaje al agente en ejecución sin detener el trabajo",
    "fr": "Envoyer un message à l’agent en cours sans arrêter le travail",
    "zh": "给正在运行的智能体发消息，而不中断工作"
  },
  "エージェント・会話・ブランチ・worktree などの情報を見ます": {
    "en": "Shows the agent, conversation, branch, worktree, and other details",
    "es": "Muestra el agente, la conversación, la rama, el worktree y otros datos",
    "fr": "Affiche l’agent, la conversation, la branche, le worktree et d’autres informations",
    "zh": "查看智能体、对话、分支、worktree 等信息"
  },
  "ドラッグで高さを変えられます（ダブルクリックで元の高さに戻します）": {
    "en": "Drag to change the height (double-click to restore)",
    "es": "Arrastra para cambiar la altura (doble clic para volver a la original)",
    "fr": "Faites glisser pour changer la hauteur (double-clic pour revenir à la hauteur d’origine)",
    "zh": "拖动可改变高度（双击恢复原来的高度）"
  },
  "追加の指示を送る（Ctrl/⌘ + Enter で送信）": {
    "en": "Send a follow-up (Ctrl/⌘ + Enter to send)",
    "es": "Enviar una indicación más (Ctrl/⌘ + Enter para enviar)",
    "fr": "Envoyer une consigne supplémentaire (Ctrl/⌘ + Entrée pour envoyer)",
    "zh": "发送补充指示（Ctrl/⌘ + Enter 发送）"
  },
  "送信（Ctrl/⌘ + Enter）": {
    "en": "Send (Ctrl/⌘ + Enter)",
    "es": "Enviar (Ctrl/⌘ + Enter)",
    "fr": "Envoyer (Ctrl/⌘ + Entrée)",
    "zh": "发送（Ctrl/⌘ + Enter）"
  },
  "送信": {
    "en": "Send",
    "es": "Enviar",
    "fr": "Envoyer",
    "zh": "发送"
  },
  "カンバン管理": {
    "en": "Kanban",
    "es": "Kanban",
    "fr": "Kanban",
    "zh": "看板"
  },
  "タスクスケジューラ": {
    "en": "Task scheduler",
    "es": "Programador de tareas",
    "fr": "Planificateur de tâches",
    "zh": "任务调度"
  },
  "設定": {
    "en": "Settings",
    "es": "Ajustes",
    "fr": "Réglages",
    "zh": "设置"
  },
  "RC設定": {
    "en": "RC settings",
    "es": "Ajustes de RC",
    "fr": "Réglages RC",
    "zh": "RC 设置"
  },
  "セッション": {
    "en": "Sessions",
    "es": "Sesiones",
    "fr": "Sessions",
    "zh": "会话"
  },
  "会話": {
    "en": "Chat",
    "es": "Conversación",
    "fr": "Conversation",
    "zh": "对话"
  },
  "チャット": {
    "en": "Chat",
    "es": "Chat",
    "fr": "Discussion",
    "zh": "聊天"
  },
  "ログ": {
    "en": "Log",
    "es": "Registro",
    "fr": "Journal",
    "zh": "日志"
  },
  "差分": {
    "en": "Diff",
    "es": "Diferencias",
    "fr": "Diff",
    "zh": "差异"
  },
  "進捗": {
    "en": "Progress",
    "es": "Progreso",
    "fr": "Progression",
    "zh": "进度"
  },
  "サブタスク": {
    "en": "Subtasks",
    "es": "Subtasks",
    "fr": "Sous-tâches",
    "zh": "子任务"
  },
  "情報": {
    "en": "Info",
    "es": "Información",
    "fr": "Informations",
    "zh": "信息"
  },
  "処理しています…": {
    "en": "Working…",
    "es": "Procesando…",
    "fr": "Traitement…",
    "zh": "正在处理…"
  },
  "{v1}（WSL）の中に git が見つかりません。{v1} のターミナルで sudo apt install git を実行してください。": {
    "en": "git was not found inside {v1} (WSL). In the {v1} terminal, run sudo apt install git.",
    "es": "No se encontró git dentro de {v1} (WSL). En la terminal de {v1}, ejecuta sudo apt install git.",
    "fr": "git est introuvable dans {v1} (WSL). Dans le terminal de {v1}, exécutez sudo apt install git.",
    "zh": "在 {v1}（WSL）里找不到 git。请在 {v1} 的终端中运行 sudo apt install git。"
  },
  "{v1}（WSL）の中に {v2} が見つかりません。{v1} のターミナルで {v3} をインストールしてログインしてください（このリポジトリのタスクは {v1} の中で動きます）。": {
    "en": "{v2} was not found inside {v1} (WSL). In the {v1} terminal, install {v3} and sign in (tasks in this repository run inside {v1}).",
    "es": "No se encontró {v2} dentro de {v1} (WSL). En la terminal de {v1}, instala {v3} e inicia sesión (las tareas de este repositorio se ejecutan dentro de {v1}).",
    "fr": "{v2} est introuvable dans {v1} (WSL). Dans le terminal de {v1}, installez {v3} et connectez-vous (les tâches de ce dépôt s’exécutent dans {v1}).",
    "zh": "在 {v1}（WSL）里找不到 {v2}。请在 {v1} 的终端中安装 {v3} 并登录（这个仓库的任务在 {v1} 里运行）。"
  },
  "git が見つかりません。Git for Windows（https://git-scm.com/）をインストールしてから、アプリを再起動してください。": {
    "en": "git was not found. Install Git for Windows (https://git-scm.com/), then restart the app.",
    "es": "No se encontró git. Instala Git for Windows (https://git-scm.com/) y vuelve a abrir la aplicación.",
    "fr": "git est introuvable. Installez Git for Windows (https://git-scm.com/), puis relancez l’application.",
    "zh": "找不到 git。请安装 Git for Windows（https://git-scm.com/），然后重新启动应用。"
  },
  "git が見つかりません。ターミナルで xcode-select --install を実行するか Homebrew で git をインストールしてから、アプリを再起動してください。": {
    "en": "git was not found. Run xcode-select --install in Terminal, or install git with Homebrew, then restart the app.",
    "es": "No se encontró git. Ejecuta xcode-select --install en la Terminal, o instala git con Homebrew, y vuelve a abrir la aplicación.",
    "fr": "git est introuvable. Exécutez xcode-select --install dans le Terminal, ou installez git avec Homebrew, puis relancez l’application.",
    "zh": "找不到 git。请在终端运行 xcode-select --install，或用 Homebrew 安装 git，然后重新启动应用。"
  },
  "git が見つかりません。git をインストールしてから、アプリを再起動してください。": {
    "en": "git was not found. Install git, then restart the app.",
    "es": "No se encontró git. Instala git y vuelve a abrir la aplicación.",
    "fr": "git est introuvable. Installez git, puis relancez l’application.",
    "zh": "找不到 git。请安装 git，然后重新启动应用。"
  },
  "{v1} コマンドが見つかりません。{v2} をインストールしてログインするか、「設定」で {v1} のフルパスを指定してください（ターミナルで which {v1}、Windows なら where {v1} で調べられます）。使わないなら、「設定」の「使うエージェント」でチェックを外してください。": {
    "en": "The {v1} command was not found. Install {v2} and sign in, or set the full path to {v1} in Settings (find it with which {v1} in a terminal, or where {v1} on Windows). If you do not use it, clear its checkbox under Settings → “Agents to use”.",
    "es": "No se encontró el comando {v1}. Instala {v2} e inicia sesión, o indica la ruta completa de {v1} en Ajustes (se puede ver con which {v1} en la terminal, o where {v1} en Windows). Si no lo usas, quita la marca en Ajustes → «Agentes en uso».",
    "fr": "La commande {v1} est introuvable. Installez {v2} et connectez-vous, ou indiquez le chemin complet de {v1} dans les réglages (which {v1} dans un terminal, where {v1} sous Windows). Si vous ne l’utilisez pas, décochez-la dans Réglages → « Agents utilisés ».",
    "zh": "找不到 {v1} 命令。请安装 {v2} 并登录，或在「设置」里填写 {v1} 的完整路径（在终端用 which {v1}，Windows 用 where {v1} 查看）。如果不用，请在「设置」的「使用的智能体」里取消勾选。"
  },
  "<span>セットアップスクリプト（worktree を作った直後に動かす）</span>": {"en": "<span>Setup script (runs right after the worktree is created)</span>", "es": "<span>Script de preparación (se ejecuta justo después de crear el worktree)</span>", "fr": "<span>Script de préparation (lancé juste après la création du worktree)</span>", "zh": "<span>初始化脚本（创建 worktree 后立即运行）</span>"},
  "例: npm install": {"en": "e.g. npm install", "es": "p. ej. npm install", "fr": "p. ex. npm install", "zh": "例如：npm install"},
  "エージェントを始める前に、worktree の中で動かします。失敗するとエージェントは始めず、タスクはエラーになります。": {"en": "Runs inside the worktree before the agent starts. If it fails, the agent does not start and the task shows an error.", "es": "Se ejecuta dentro del worktree antes de iniciar el agente. Si falla, el agente no se inicia y la tarea queda en error.", "fr": "Lancé dans le worktree avant le démarrage de l’agent. En cas d’échec, l’agent ne démarre pas et la tâche passe en erreur.", "zh": "在智能体启动前于 worktree 中运行。失败时不会启动智能体，任务变为错误状态。"},
  "<span>片付けスクリプト（worktree を消す直前に動かす）</span>": {"en": "<span>Cleanup script (runs right before the worktree is removed)</span>", "es": "<span>Script de limpieza (se ejecuta justo antes de eliminar el worktree)</span>", "fr": "<span>Script de nettoyage (lancé juste avant la suppression du worktree)</span>", "zh": "<span>清理脚本（删除 worktree 前运行）</span>"},
  "例: docker compose down": {"en": "e.g. docker compose down", "es": "p. ej. docker compose down", "fr": "p. ex. docker compose down", "zh": "例如：docker compose down"},
  "マージ・破棄などで worktree を消す前に動かします。失敗してもログに警告を残して worktree は消します。5分で打ち切ります。": {"en": "Runs before the worktree is removed by a merge, discard and so on. If it fails, a warning is logged and the worktree is still removed. It is stopped after 5 minutes.", "es": "Se ejecuta antes de eliminar el worktree al fusionar, descartar, etc. Si falla, se registra una advertencia y el worktree se elimina igualmente. Se detiene a los 5 minutos.", "fr": "Lancé avant la suppression du worktree (fusion, abandon, etc.). En cas d’échec, un avertissement est journalisé et le worktree est quand même supprimé. Arrêté au bout de 5 minutes.", "zh": "在合并、丢弃等删除 worktree 之前运行。失败时会在日志中留下警告，但仍会删除 worktree。5 分钟后强制结束。"},
  "<span>実行スクリプト（詳細の worktree タブのボタンで動かす）</span>": {"en": "<span>Run script (started from the worktree tab in the details)</span>", "es": "<span>Script de ejecución (se lanza desde la pestaña worktree del detalle)</span>", "fr": "<span>Script d’exécution (lancé depuis l’onglet worktree du détail)</span>", "zh": "<span>运行脚本（在详情的 worktree 标签页中启动）</span>"},
  "例: npm run dev": {"en": "e.g. npm run dev", "es": "p. ej. npm run dev", "fr": "p. ex. npm run dev", "zh": "例如：npm run dev"},
  "開発サーバーなど、タスクの変更を手で確かめるためのコマンドです。worktree タブから動かす・止めることができ、セットアップと片付けも手で動かせます。": {"en": "A command for checking the task’s changes by hand, such as a dev server. You can start and stop it from the worktree tab, and run setup and cleanup by hand there too.", "es": "Un comando para comprobar a mano los cambios de la tarea, como un servidor de desarrollo. Puedes iniciarlo y detenerlo desde la pestaña worktree, y ejecutar allí también la preparación y la limpieza.", "fr": "Une commande pour vérifier à la main les changements de la tâche, comme un serveur de développement. Vous pouvez la lancer et l’arrêter depuis l’onglet worktree, et y lancer aussi la préparation et le nettoyage.", "zh": "用于手动检查任务改动的命令，例如开发服务器。可在 worktree 标签页中启动和停止，也可在那里手动运行初始化和清理。"},
  "スクリプトは macOS・Linux・WSL では sh / bash で動き、途中の行が失敗するとそこで止まります。Windows では各行を && でつないで cmd で動かします。環境変数 WORKTREE_KANBAN_ROOT（リポジトリ）、WORKTREE_KANBAN_WORKTREE、WORKTREE_KANBAN_BRANCH、WORKTREE_KANBAN_BASE_BRANCH、WORKTREE_KANBAN_TASK_ID が使えます。": {"en": "On macOS, Linux and WSL, scripts run in sh / bash and stop at the first failing line. On Windows, the lines are joined with && and run in cmd. These environment variables are available: WORKTREE_KANBAN_ROOT (the repository), WORKTREE_KANBAN_WORKTREE, WORKTREE_KANBAN_BRANCH, WORKTREE_KANBAN_BASE_BRANCH and WORKTREE_KANBAN_TASK_ID.", "es": "En macOS, Linux y WSL, los scripts se ejecutan en sh / bash y se detienen en la primera línea que falla. En Windows, las líneas se unen con && y se ejecutan en cmd. Están disponibles las variables de entorno WORKTREE_KANBAN_ROOT (el repositorio), WORKTREE_KANBAN_WORKTREE, WORKTREE_KANBAN_BRANCH, WORKTREE_KANBAN_BASE_BRANCH y WORKTREE_KANBAN_TASK_ID.", "fr": "Sous macOS, Linux et WSL, les scripts s’exécutent dans sh / bash et s’arrêtent à la première ligne en échec. Sous Windows, les lignes sont reliées par && et exécutées dans cmd. Variables d’environnement disponibles : WORKTREE_KANBAN_ROOT (le dépôt), WORKTREE_KANBAN_WORKTREE, WORKTREE_KANBAN_BRANCH, WORKTREE_KANBAN_BASE_BRANCH et WORKTREE_KANBAN_TASK_ID.", "zh": "在 macOS、Linux 和 WSL 上，脚本通过 sh / bash 运行，某行失败时即停止。在 Windows 上，各行用 && 连接后通过 cmd 运行。可使用环境变量 WORKTREE_KANBAN_ROOT（仓库）、WORKTREE_KANBAN_WORKTREE、WORKTREE_KANBAN_BRANCH、WORKTREE_KANBAN_BASE_BRANCH 和 WORKTREE_KANBAN_TASK_ID。"},
});
