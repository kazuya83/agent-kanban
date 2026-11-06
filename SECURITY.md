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
- Board state stays on your machine. Worktree Kanban has no external server.
