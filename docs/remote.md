[English](remote.md) · [日本語](remote.ja.md)

# Remote control (operate the board from another PC over an SSH tunnel)

You can view and operate the board of the PC running the agents (the **host**) from Worktree Kanban on another PC (the **client**), **almost as if you were sitting at it**.

- The host and the client can each be **Mac or Windows** (Windows → Mac, Windows → Windows, Mac → Windows, and Mac → Mac all work). Any machine can be either a host or a client
- The host app listens only on `127.0.0.1`, so it is not directly exposed to the internet. You connect through **SSH port forwarding** (the client app starts `ssh` and opens the tunnel)
- To connect while away from home or the office, install [Tailscale](https://tailscale.com/) on both PCs. No router configuration is needed

> If you put the Tailscale IP (`100.x.x.x`) in "Host" and connect directly, you get `connect ETIMEDOUT`, because the host listens only on `127.0.0.1`. Set the connection method to **"via SSH"** and put the Tailscale IP in the **SSH target** instead.

## Overview

| | Host (the PC doing the work) | Client (the PC you operate from) |
| --- | --- | --- |
| 1 | Install Tailscale and sign in | Install Tailscale and sign in with the same account |
| 2 | Turn on the SSH server | **Create a key** in "RC settings" in Worktree Kanban |
| 3 | Register the received public key by choosing it in "RC settings" | Confirm you can get in with `ssh` without a password |
| 4 | "Start host" in Worktree Kanban | Connect "via SSH" in Worktree Kanban |

Steps 1 to 3 are needed only once.

## 1. Install Tailscale (both PCs)

1. Install [Tailscale](https://tailscale.com/download) on both PCs and sign in with the **same account**
2. On both PCs, confirm that Tailscale is **Connected**. The host's IP (`100.x.x.x`) and machine name are shown in the Tailscale menu and in the [admin console](https://login.tailscale.com/admin/machines)
3. Run the following in a terminal on the client. If you get a reply, the two are connected

   ```bash
   tailscale ping <host's Tailscale IP>
   ```

   (If `tailscale` is not found on a Mac, use `/Applications/Tailscale.app/Contents/MacOS/Tailscale ping <IP>`)

> If the other machine shows as **offline** in the admin console, SSH always times out. Windows goes offline while logged off or asleep, or when Tailscale has been quit.

If you only use it within one LAN, you can use the host's LAN IP (such as `192.168.x.x`) instead of Tailscale.

## 2. Turn on the SSH server on the host

### If the host is a Mac

Turn on "System Settings → General → Sharing → **Remote Login**" (the "i" button lets you choose which users can log in).

### If the host is Windows

In an administrator PowerShell, install the OpenSSH server, start it, and set it to start automatically (you can also add "OpenSSH Server" from "Settings → System → Optional features → View features").

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
Start-Service sshd
Set-Service sshd -StartupType Automatic
```

Also check that SSH (port 22) is open in the firewall. If the first line shows nothing, the second line opens it.

```powershell
Get-NetFirewallRule -Name *OpenSSH-Server* | Select-Object Name, Enabled, Profile
New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
```

### Check it

Open **"RC settings"** at the top of Worktree Kanban on the host. It shows **the SSH target to enter on the client (the Tailscale IP), the user name, and whether the SSH server is running**. If it says "Not running", redo the steps above.

## 3. Create an SSH key and register it on the host

The app cannot enter a password, so you set things up to **log in over SSH with a key**. The client app handles creating the key, and **you pass the public key file to the host yourself** (so that the host's password is never given to the app). Once the host has the public key, you only have to choose it in the host app to register it.

### Create the key on the client (the app can do this)

1. Open **"RC settings"** at the top of Worktree Kanban on the client, and set the connection method under "Client" to **via SSH**
2. Press **"Create key"** under "① Create an SSH key". An ed25519 key without a passphrase is created at `~/.ssh/agent-kanban_ed25519` (on Windows, `C:\Users\<you>\.ssh\agent-kanban_ed25519`) and entered in the "Key file" field
3. The public key and the commands that register it on the host (for a Mac host, a Windows administrator, and a Windows non-administrator) appear. Copy them with **"Copy"**

If you already have a key, enter its path in "Key file" to see its public key and registration commands (keys with a passphrase cannot be used from the app). You can also create one yourself with `ssh-keygen -t ed25519`.

If Windows says ssh-keygen was not found, add "OpenSSH Client" under "Settings → System → Optional features".

### Register the public key on the host (in Worktree Kanban on the host)

1. Put the **public key file** created on the client (`agent-kanban_ed25519.pub`; its location is shown under "① SSH key" in RC settings) anywhere on the host PC, using a USB stick, a shared folder, email, or the like. **Do not hand over the private key (the file without `.pub`)**
2. Open **"RC settings"** at the top of Worktree Kanban on the host, and under **"Register the client public key"** in "Host", use **"Choose file…"** to choose the `.pub` file you placed there
3. Press **"Register"** to allow SSH logins
   - Mac: the key is added to `~/.ssh/authorized_keys` and the permissions are set to 600
   - Windows, administrator user: the key is added to `C:\ProgramData\ssh\administrators_authorized_keys` and permissions are restricted with `icacls`. If it says it cannot write, reopen Worktree Kanban with "Run as administrator", or run the displayed command in an administrator PowerShell
   - Windows, non-administrator user: the key is added to `C:\Users\<you>\.ssh\authorized_keys`

A key that is already registered is not added twice. If you choose a private key, it stops without registering anything.

To register without the app, you can run the command for the host's OS, shown in the client's RC settings, **on the host PC**. The steps below show how to do this by hand.

### Register the public key by hand (Mac host)

If the client is **Windows**, in PowerShell:

```powershell
type $env:USERPROFILE\.ssh\agent-kanban_ed25519.pub | ssh <user name>@<host IP> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

If the client is a **Mac**, in a terminal:

```bash
ssh-copy-id -i ~/.ssh/agent-kanban_ed25519.pub <user name>@<host IP>
```

Either way, you are asked for the host's password this one time. The user name is what `whoami` prints in a terminal on the host.

### Register the public key by hand (Windows host)

On the Windows OpenSSH server, where the key goes depends on **whether the host user is an administrator**.

1. Open the client's `agent-kanban_ed25519.pub` (on Windows, `C:\Users\<you>\.ssh\agent-kanban_ed25519.pub`) in Notepad or the like and copy the whole line, or use "Copy public key" in RC settings
2. Open PowerShell on the host, paste that line into the `'…'` below, and run it

   **If the host user is an administrator** (the usual case on a personal PC; use **Run as administrator** for PowerShell):

   ```powershell
   $key = 'ssh-ed25519 AAAA... you@client'
   Add-Content -Path C:\ProgramData\ssh\administrators_authorized_keys -Value $key
   icacls.exe C:\ProgramData\ssh\administrators_authorized_keys /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F"
   ```

   **If not an administrator**:

   ```powershell
   $key = 'ssh-ed25519 AAAA... you@client'
   New-Item -ItemType Directory -Force $env:USERPROFILE\.ssh | Out-Null
   Add-Content -Path $env:USERPROFILE\.ssh\authorized_keys -Value $key
   ```

The user name is what `$env:USERNAME` prints in PowerShell on the host (even with a Microsoft account, use this name rather than the email address).

### Confirm you can log in without a password

Run the following on the client. If it finishes **without asking for a password**, you are ready (a ready-to-use command also appears at "③" in RC settings).

```bash
ssh -i ~/.ssh/agent-kanban_ed25519 <user name>@<host IP> exit
```

The first time, it asks "Are you sure you want to continue connecting". Answer `yes`.

## 4. Connect

1. On the **host**, press "RC settings" → "Start host" at the top of Worktree Kanban (a 6-digit pairing code appears; the default listen port is `17831`)
2. On the **client**, open "RC settings" at the top of Worktree Kanban, enter the following under Client, and connect
   - Connection method: **via SSH**
   - SSH target: the host's Tailscale IP (`100.x.x.x`) or name (the value shown on the host's settings screen)
   - User name: the host's login name (the value shown on the host's settings screen)
   - SSH port: `22`; key file: the key created by the app (pressing "Create key" fills it in automatically)
   - Host listen port: `17831`; pairing code: the 6 digits shown on the host
3. While the pill at the top shows "Remote control", the host's board, approvals, questions, and follow-up instructions all work as they are. Disconnecting also closes the tunnel

### Resume the previous connection from the second time on

After you connect once, the token and target are saved, so from the second time on you do not need the code or any input.

- If you **quit the app while connected**, it **resumes the previous connection automatically** at the next launch. The pill at the top shows "Resuming the previous connection…", and once connected you are on the host's board (if the host has not started yet, for example, it retries several times with a pause in between)
- If **the line drops or the host app restarts**, it reconnects automatically too
- If you press **"Disconnect"** yourself, it does not connect automatically at the next launch. Just press **"↻ Resume previous connection"** at the top to connect (the same button is in RC settings)
- To stop automatic resuming, press "Stop resuming" in RC settings. If the pairing was dropped on the host, automatic resuming stops and you go back to pairing with the 6-digit code

### Choose from previous connections

Targets you have connected to are kept with their tokens, **up to 10, newest first**. "Previous connections" under "Client" in RC settings lists a card for each target (`user@100.x.x.x`, via SSH or direct, the host port, and when you last connected).

- **Just press a card** to connect with that target and its saved token (no code or input needed). This is also all it takes to switch between several hosts
- The target you connected to last is marked as the previous one. "↻ Resume previous connection" at the top connects to it
- **"×"** on a card removes that connection from the list (and forgets the saved token)
- A connection that failed because the pairing was dropped on the host leaves the list. Pair again with the 6-digit code and it comes back

If you want to open `ssh -L 17831:127.0.0.1:17831 <user>@<host>` yourself, set the connection method to "Direct" and the host to `127.0.0.1`.

## Troubleshooting

| Message | Common cause and fix |
| --- | --- |
| The SSH connection **timed out** | There is no reply from the other side. Check: ① Tailscale is connected on both PCs (not offline in the admin console, and `tailscale ping <IP>` gets a reply) ② the IP or name matches the value on the host's settings screen ③ the host is not asleep ④ the SSH server is running on the host ("2." above) ⑤ the host's firewall (on a Mac, "Stealth Mode" and "Block all incoming connections"; on Windows, the inbound rule for port 22) |
| The SSH connection was **refused** | The SSH server is not running on the host (on a Mac, "Remote Login"; on Windows, the `sshd` service). If the SSH port is not 22, match the "SSH port" setting too |
| SSH **authentication failed** | The key is not registered, or the user name is wrong. Redo "3." above and confirm that `ssh <user name>@<IP> exit` works without a password. If the host is Windows and the user is an administrator, the key must be in `administrators_authorized_keys` with permissions restricted by `icacls` |
| The host key has changed | The key changed, for example because the host was reinstalled. Run `ssh-keygen -R <IP>` on the client, then connect again |
| SSH connected, but Worktree Kanban on the host did not respond | "Start host" has not been pressed on the host, or the listen port is wrong |
| Port forwarding was refused | `AllowTcpForwarding no` is set in the host's `sshd_config` (on a Mac, `/etc/ssh/sshd_config`; on Windows, `C:\ProgramData\ssh\sshd_config`) |
| The following settings could not be saved because Worktree Kanban on the host is out of date | The host app is old and does not know newer settings such as custom agents or Pipeline flowcharts. Update Worktree Kanban on the host ("App updates" in Settings) and save again |
| The ssh command was not found | On Windows, add "OpenSSH Client". You can also enter the full path in the "ssh command" setting |

## Other notes

- Stopping the host, dropping pairings, and forgetting the token are on the same "RC settings" screen. You can also open it by pressing the "Remote control" or "Host listening" pill at the top
- While you are viewing a host tab, the board, working directories (worktrees), and agents are all **the host's**. The tabs at the top left show **the host's repositories**, marked with the connection target
- You can also open **this machine's (the client's) repositories** in tabs during remote control. Choose "Host" or "This machine" at the top of the screen opened from the "+" at the top left or a tab's repository name. Tabs for this machine appear to the right of the host tabs, marked "This machine", and their tasks run on this machine's agents. Host tasks and tasks on this machine can run side by side at the same time
- Tabs for this machine are **not shown on the host and are never sent to it** (the host's screen shows only the host's tabs). Up to 3 tabs are allowed on each of the host and this machine. Close a tab with its "×" (if the other side has a tab, the last tab on this side can be closed too)
- Even if the host is itself connected to another PC as a client, a client connected to it sees only the host's own tabs and board (repositories from that other connection do not mix in)
- While viewing a tab for this machine, "Open folder" (Finder or Explorer) and the like work as usual. When you disconnect, only the tabs for this machine remain
- During remote control, you can also **switch to the host's repositories** from the repository area at the top left. Choose a repository recently opened on the host, or browse the host's folders on this screen with "Open a folder on the host" (you can also enter a path directly). "Choose…" under "Location" for cloning and creating new repositories also picks from the host's folders
- "Open folder" (Finder or Explorer) is not available on host tabs, because it would open on the host's screen
- A pairing code expires after 10 minutes and becomes invalid after 5 wrong attempts (issue a new one on the host). Secrets such as tokens are not sent to the remote side

---

[← Back to README](../README.md)
