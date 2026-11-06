[English](install.md) · [日本語](install.ja.md)

# Install

## Install with a command (recommended)

**Mac / Linux** (run in a terminal)

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.sh | bash
```

- Mac: detects Apple Silicon or Intel and installs into `/Applications`. It also automatically prevents the warning shown for unsigned apps
- Linux: places the AppImage at `~/.local/bin/worktree-kanban` and adds it to the application menu (it can also be started by the previous name, `agent-kanban`)

**Windows** (run in PowerShell)

```powershell
irm https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.ps1 | iex
```

Downloads the latest version into `%LOCALAPPDATA%\Programs\Worktree Kanban`, creates shortcuts in the Start menu and on the desktop, and launches the app. Administrator rights are not needed.

## Update (to the latest version)

The same command as the install replaces your app with the latest version from [Releases](https://github.com/kazuya83/worktree-kanban/releases). Your board and task data stay as they are. If you installed under a previous name (Agent Kanban or Claude Agent Kanban), the same command replaces it with Worktree Kanban and removes the old app and shortcuts (your data keeps working). If the app is running, quit it before running the command (Windows quits it automatically).

**Updating from the app**: "App updates" in Settings shows the current version and whether a new one is available (checked at launch and every 6 hours; a new version is also shown next to the version at the top left, and pressing it opens "App updates" in Settings). Press "Update to the new version" to quit the app, replace it with the new version the same way as the commands below, and relaunch. Running tasks are interrupted and their changes so far are committed to their branches, so you can continue with "Resume" after the relaunch.

- If you check "Update automatically when a new version is released", the app waits until no tasks are running or queued after finding a new version, then replaces itself (off by default; it does not replace itself while being operated from another PC)
- The install location is the same as with the commands below (Mac: /Applications or ~/Applications; Linux: ~/.local/bin; Windows: %LOCALAPPDATA%\Programs\Worktree Kanban). On Linux this works only when the app was started as an AppImage. It is not available in development builds (`npm start`)
- If the update fails, the original version is relaunched and tells you at the next launch. The record is available from "Open the update log" under "App updates" (update.log in the userData folder)

**Mac / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.sh | bash
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.ps1 | iex
```

> If an old version is installed right after a release, GitHub's cache (up to 5 minutes) is still in place. Wait a little and run the command again.

<details>
<summary>Pin a version or uninstall</summary>

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

(If you installed with setup.exe, remove "Worktree Kanban" from Windows "Settings → Apps". Copies installed under a previous name appear as "Agent Kanban" or "Claude Agent Kanban".)

</details>

## Install from a downloaded file

Download the file for your OS from [Releases](https://github.com/kazuya83/worktree-kanban/releases).

| OS | File | How to use it |
| --- | --- | --- |
| Windows | `worktree-kanban-x.y.z-win-setup.exe` | Installer. Double-click to install |
| Windows | `worktree-kanban-x.y.z-win-portable.exe` | Runs as is, without installing |
| Windows | `worktree-kanban-x.y.z-win-x64.zip` | Extract it and run `Worktree Kanban.exe` inside |
| Mac (Apple Silicon: M1 and later) | `worktree-kanban-x.y.z-mac-arm64.dmg` | Open it and drag the app to "Applications" |
| Mac (Intel) | `worktree-kanban-x.y.z-mac-x64.dmg` | Same as above |
| Linux | `worktree-kanban-x.y.z-linux-x86_64.AppImage` | Make it executable and run it |

> **First launch**
> The app is not signed with a developer certificate, so the OS shows a warning.
> - **Mac**: if it says the developer cannot be verified, right-click the app and choose "Open". If it still does not open, run `xattr -cr "/Applications/Worktree Kanban.app"` in a terminal
> - **Windows**: if you see "Windows protected your PC", press "More info" → "Run anyway"

Besides the app, you need **git** and the CLI of the agent you use (one of **Claude Code / Codex CLI / Gemini CLI / Cursor CLI**, signed in). The app automatically looks for `claude` / `codex` / `gemini` / `cursor-agent` on your terminal's PATH. If one is not found, a notice appears at the top of the screen (you can also set the full path under "Agents to use" in Settings).

## Use WSL (Ubuntu and others) repositories on Windows

On Windows, pressing "Choose a repository" lets you choose between **a folder on this computer** and **a WSL (Ubuntu and others) folder**.

- Pressing "Open a folder in Ubuntu" opens the Explorer dialog at the Ubuntu home folder (`\\wsl.localhost\Ubuntu\home\…`). Choosing an Ubuntu folder from "Linux" on the left side of Explorer works the same way
- For a WSL repository, **git and claude run inside WSL** (worktrees are also created inside WSL). Handling WSL files with Windows git or claude is slow, stops on git's ownership check, and makes an agent's `npm install` and the like install the Windows versions
- For that reason, **git and Claude Code (signed in) are also needed inside WSL**. If something is missing, a notice appears at the top of the screen

  ```bash
  sudo apt install git
  ```

  Install Claude Code in a WSL terminal following the official steps, then start `claude` once and sign in
- Card approvals and questions from the agent reach the Windows app from the claude running inside WSL (the app's window stays on Windows)
- The conversation list and skills are read from `~/.claude` inside WSL
- "Open folder" opens the WSL folder in Explorer

---

[← Back to README](../README.md)
