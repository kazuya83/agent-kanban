# Security Policy

## Supported versions

Worktree Kanban ships often. Security fixes go into the next release only, so please update to the [latest release](https://github.com/kazuya83/worktree-kanban/releases/latest) before you report. You can update from "Settings" → "App update", or by running the install command again.

## Reporting a vulnerability

**Please do not report vulnerabilities in public issues, discussions, or pull requests.**

Report privately through [GitHub's private vulnerability reporting](https://github.com/kazuya83/worktree-kanban/security/advisories/new). Include:

- The version and OS you tested on
- What an attacker can do, and what access they need first
- Steps to reproduce, or a proof of concept

This is a project with one maintainer, so responses are best effort. You will get an acknowledgement in the advisory, and the fix and disclosure timing will be agreed there. Please give us a reasonable chance to release a fix before you disclose publicly.

## Scope

In scope, for example:

- The remote control server and its client: pairing, tokens, and anything reachable over the SSH tunnel
- The local approval server, and ways to bypass approval on a card
- Token storage, and ways to read a saved integration token
- Starting a task from Slack without being on the allow list
- Approving or answering from Slack without being on the allow list
- Command, argument, or path injection through branch names, Issue text, repository content, or other outside input
- `install.sh`, `install.ps1`, and the in-app updater

Out of scope:

- Vulnerabilities in the agent CLIs themselves (Claude Code, Codex CLI, Antigravity CLI, Gemini CLI, Cursor CLI), `git`, `gh`, or `ssh`. Please report those to their own projects.
- Actions an agent takes after you approved them, or that your permission mode or `--allowedTools` allows automatically
- Issues that need an attacker who already controls your user account on the machine
- The warning the OS shows on first launch. The builds are not signed with a developer certificate.

## How the app handles connections

- The approval server and the remote control server listen only on `127.0.0.1`, and both require a token.
- Remote clients reach the host through an `ssh -N -L` tunnel. The host app does not open a port to the network.
- First-time remote pairing uses a 6-digit code shown on the host. The code expires, and it stops working after 5 failed attempts.
- Board state stays on your machine. Worktree Kanban has no external server. If you connect GitLab, Linear, Jira, or Slack, the app talks to those services directly from your machine.

## How the app handles integration tokens

- Tokens are encrypted with a key from the OS secure storage (Electron's `safeStorage`) and saved in `secrets.json` in the app's data folder, separate from `board.json`.
- Tokens are never saved in plain text. If secure storage is not available, including on Linux without a keyring, saving fails.
- Saved tokens are read only in the main process, right before they are sent to their service. They are not passed to the UI, remote clients, logs, or agent environment variables. The UI only learns whether a token is set.
- API calls use https. An `http://` address for GitLab or Jira needs an explicit opt-in, and the token then travels unencrypted.
- Redirects are not followed, and changing a service's URL deletes tokens you did not enter again, so a saved token is not sent to a different address.

## Starting tasks and approving from Slack

Starting a task or allowing a tool means an agent runs code on your machine, so access is opt-in:

- Only the Slack user IDs you list can start a task, approve, or answer. The list is empty by default, so nobody can. It is checked again when a form is submitted.
- Tasks start only from channels you map to a project.
- Only the text of the message that mentions the bot becomes instructions. The rest of the thread is not read. Allowed users' text still reaches the agent as instructions, so list only people you would let run code on this machine.
- Receiving uses Slack's Socket Mode. The app connects out to Slack and opens no port.
- The project's permission settings apply as usual. Slack offers Allow only when the full tool input can be shown; otherwise it offers only Deny. "Always allow" is available only in the app.
- Permission notifications include up to 4,000 characters of tool input, so everyone in the channel can read it. Post them to a channel limited to people who may see it.
