<div align="center">

<img src="docs/images/icon.png" alt="" width="96" />

# Worktree Kanban

<strong>A board for chaining AI coding agents into flowcharts, where people make the key decisions.</strong><br />
Implement with Codex, review with Claude, and send it back if needed. Whether it merges is your call.

[Website](https://kazuya83.github.io/worktree-kanban/) · [Download](https://github.com/kazuya83/worktree-kanban/releases/latest)

[![Release](https://img.shields.io/github/v/release/kazuya83/worktree-kanban?label=release&color=3b5bfd)](https://github.com/kazuya83/worktree-kanban/releases/latest)
[![Platforms](https://img.shields.io/badge/platforms-Mac%20%7C%20Windows%20%7C%20Linux-52525B)](https://github.com/kazuya83/worktree-kanban/releases/latest)
[![Pipeline](https://img.shields.io/badge/pipeline-Codex%20%E2%86%92%20Claude%20%E2%86%92%20you-0891B2)](docs/images/en/feature-pipeline.gif)
[![Agents](https://img.shields.io/badge/agents-Claude%20Code%20%7C%20Codex%20%7C%20Antigravity%20%7C%20Gemini%20%7C%20Cursor-7C3AED)](https://github.com/kazuya83/worktree-kanban#readme)
[![License](https://img.shields.io/badge/license-FSL--1.1--ALv2-52525B)](LICENSE)

[English](README.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Français](README.fr.md) · [简体中文](README.zh-CN.md)

</div>

<div align="center">

![Demo: describe a flow in plain language, watch Codex implement and Claude review and send it back, approve a command, check the diff, and merge](docs/images/en/demo.gif)

</div>

A desktop app (Electron, Mac / Windows / Linux) that runs AI coding-agent CLIs (Claude Code / Codex CLI / Antigravity CLI / Gemini CLI / Cursor CLI) in parallel, each task in its own git worktree, and manages them on a kanban board. **It can run tasks from more than one repository at the same time, not only tasks inside a single repository.**

![Board: Todo, Running, Review, and Done columns. Cards in Running show question, waiting-for-approval, and working states](docs/images/en/board.png)

## Why Worktree Kanban?

- **Agents in a flowchart** — describe a flow in plain language or draw it, and agents hand the work over step by step, following branches, loops, and parallel steps.
- **You stay in charge** — check the diff before you merge or open a PR. With Claude Code, Codex, and Cursor, you also approve actions on the card.
- **One task, one worktree** — each task gets its own git worktree and branch, so tasks never collide with each other or with your working tree.
- **Several repositories at once** — keep up to 3 repositories open as tabs; switching tabs does not stop anything.
- **The CLIs you already use** — Claude Code, Codex CLI, Antigravity CLI, Gemini CLI, and Cursor CLI, with the sign-in and settings you have today.
- **Mac ⇄ Windows remote control** — run agents on one PC and operate the same board from the other: approve, answer questions, send instructions, and merge.
- **Local by design** — board state stays on your machine. There is no external server. Services you connect are reached directly from your machine.

## How it works

```mermaid
flowchart LR
    C["Client PC"] -- "SSH tunnel" --> B
    subgraph H["Host PC"]
        B["Board"] --> W1["worktree + branch 1"] --> A1["Agent CLI"]
        B --> W2["worktree + branch 2"] --> A2["Agent CLI"]
        A1 --> R["Your repository"]
        A2 --> R
    end
    R -- "Merge / PR" --> O(("main"))
```

- **1 task = 1 worktree = 1 branch.** It creates a worktree at `<repo>.worktrees/<id>` next to the repository and works on a branch named `agent/<summary>-<id>`. Tasks do not collide with each other or with the working tree you have open
- **The agent is the CLI, started as-is.** Claude Code runs as `claude -p --input-format stream-json --output-format stream-json`, and its output is shown on the card as the log. Sign-in, model, `CLAUDE.md`, and skills are the same ones you use in the terminal
- **Approval goes through Claude Code's `--permission-prompt-tool`, Codex's `codex app-server`, and Cursor's `cursor-agent acp`.** Only actions that the permission mode or `--allowedTools` (the allowed tools setting in Worktree Kanban) does not auto-allow show up on the card as waiting for approval
- **When it finishes, you bring the work in by merging (`--no-ff`) or opening a PR / MR (`gh` for GitHub, the API for GitLab).** You can choose the target branch, and you can push to origin after the merge
- Board state is stored in `board.json` in Electron's userData folder. There is no external server

On Codex / Antigravity / Gemini / Cursor, multiple-choice questions, btw, and cost display are unavailable because of CLI limits. In-card approval works on Codex and Cursor, but not on Antigravity or Gemini (see [docs/agents.md](docs/agents.md)).

## Features

### Operate from another PC (RC)

You can operate the board on the PC that runs the agents (the host) from Worktree Kanban on another PC (the client). Either Mac or Windows can be the host, and either can be the client. On the client you can approve, answer questions, send extra instructions, merge, and so on, the same way as on the host screen.

![Connecting from another PC, then approving on the host’s board](docs/images/en/feature-remote.gif)

- The host app listens only on `127.0.0.1`. The client app connects with an `ssh -N -L` tunnel, so the host only needs an SSH server. Use Tailscale or similar when you connect from outside
- SSH uses a key. In the client's "RC settings", create an ed25519 key (`~/.ssh/agent-kanban_ed25519`) and register the public key in the host's "RC settings"
- The first time, you pair with a 6-digit code shown on the host. After that, a saved token reconnects to the previous destination

![Client RC settings (SSH destination and key)](docs/images/en/rc-settings.png)

![Operating the host board from the client (the top shows "Remote control → SSH 100.101.102.103")](docs/images/en/rc-client.png)

Steps, and how to fix a connection that fails, are in [docs/remote.md](docs/remote.md).

Also included: drag-and-drop changes to a card's state (column), messages to a running agent (btw), image and file attachments, competition (several agents solving the same task), and WSL repositories on Windows. Usage is summarized in [docs/usage.md](docs/usage.md).

### Pipeline: describe a flow in plain language and run tasks on it
Write the flow you want in plain language, such as "implement with Codex, review with Claude, and go back to implementation if changes are needed", and the agent builds the flowchart. Pick that Pipeline when you create a task, and agents hand the work over step by step, following its branches and loops. You can also edit the flowchart by hand.

![Writing a flow in plain language, picking it for a new task, and watching the steps run and loop back after a review](docs/images/en/feature-pipeline.gif)

See [docs/agents.md](docs/agents.md) for details.

### Subtasks
When a task is large, the agent can propose splitting it into subtasks. They branch from the parent branch, run in parallel or in order, and are merged back as they finish. You can also start a single subtask, and GitHub, GitLab, Linear, and Jira sub-issues are supported.

![Accepting a proposal to split a task, then watching the subtasks run and merge](docs/images/en/feature-subtasks.gif)

### Run several repositories in parallel

Repositories open as tabs (up to 3). Switching tabs does not stop tasks in the other repositories. A tab that is not selected shows **how many tasks are running** (blue) and **how many tasks are waiting for you** (approval, a question, and so on, in orange), so you can see which repository needs you from the tabs alone. The limit on how many tasks run at once (the setting for how many to run at once) is shared across every repository.

![Switching between repository tabs while tasks keep running in the others](docs/images/en/feature-repos.gif)

![Three repositories open as tabs. Inactive tabs show how many tasks are running and how many are waiting for you](docs/images/en/repo-tabs.png)

The "+" on the tab bar, or clicking the open tab, lets you pick from recently opened repositories. You can also clone from a URL or create a new repository from there.

You can open a folder that is not a git repository (video production and other work that is not code). In that case it runs the task directly in the folder without creating a worktree, and you finish it with "Mark done" (see [docs/usage.md](docs/usage.md)).

![Repository picker (recent repositories, and the ones open in tabs)](docs/images/en/repo-switch.png)

### Approval

When an action needs permission, you can read the full command and input on the card and in the detail panel, then choose allow, deny, or always allow for this task. When you deny, you can send a reason back to the agent.

![Reading the full command, then approving it](docs/images/en/feature-approval.gif)

<details>
<summary>Screenshot</summary>

![A card waiting for approval, and the detail panel](docs/images/en/detail-permission.png)

</details>

### Integrations (GitHub, GitLab, Linear, Jira, Slack)

Create tasks from Issues and keep their status in sync. You can also post notifications to Slack and start tasks from Slack.

| Service | Input for a task | PR / MR body | Status sync | What you need to connect |
| --- | --- | --- | --- | --- |
| GitHub | `21, 22, 24` | `Closes #21` | Status in GitHub Projects | `gh` |
| GitLab | `12`, `group/project#12`, URL | `Closes #12` | Labels and open / closed | URL, Personal Access Token (`api`) |
| Linear | `ENG-123`, URL | `Ref ENG-123 <URL>` | Workflow state | API key |
| Jira | `ABC-123`, URL | `ABC-123 <URL>` | Transition | URL, plus an API token and email (Cloud) or a Personal Access Token (Data Center) |

It builds the instructions from the Issue title, body, and comments, and creates one card per Issue. Branches are named like `agent/issue-21-…`. Sub-issues work with all four services, and comments back to the Issue work with GitLab, Linear, and Jira.

- **GitLab**: works with gitlab.com and self-hosted GitLab. If origin belongs to the connected GitLab, the app uses the API instead of `gh` to create MRs and to check merges, conflicts, and pipeline results
- **Linear and Jira**: these only handle issues. PRs and MRs are created on the repository's host. Jira works with Cloud and Data Center
- **Slack**: posts completions, failures, and items waiting for you. Allowed Slack users can start a task with a mention or a slash command in a listed channel. Nobody can start a task by default. It uses Socket Mode, so no port is opened, but it works only while the app is open. Approvals and answers to questions stay in the app

To set up:

1. In "Settings" → "Integrations", enter the address and token, then save. Tokens are encrypted with a key from the OS secure storage
2. In "Settings" → "Issue sync", choose "Issue tracker to use" for each project
3. Enter numbers or URLs on the Issue tab of "New task"

How to create the Slack app, and details for each service, are in [docs/integrations.md](docs/integrations.md).

![Entering Issue numbers to create one card per Issue](docs/images/en/feature-issue.gif)

<details>
<summary>Screenshot</summary>

![Dialog that creates tasks from Issues](docs/images/en/issue-dialog.png)

</details>

### Questions from the agent

When Claude Code asks with `AskUserQuestion`, the card becomes a question and an answer form appears. Multiple choice and free text (Other) are both supported.

![Answering an agent’s question by choosing an option](docs/images/en/feature-question.gif)

<details>
<summary>Screenshot</summary>

![Question answer form](docs/images/en/question.png)

</details>

### worktree and diff

The "worktree" tab shows the branch commits, uncommitted changes, how the branch relates to the base, and the other worktrees in the same repository. On the "diff" tab you pick changed files in a tree grouped by folder and read the diff file by file.

![Reviewing the diff, then merging](docs/images/en/feature-merge.gif)

<details>
<summary>Screenshot</summary>

![worktree tab](docs/images/en/worktree.png)

![Diff tab](docs/images/en/diff.png)

</details>

### Chat

In "Chat" you can ask the agent about the repository without creating a task (worktree). Replies are shown as Markdown. When you want it to start working, "Make this a task" continues that conversation as a task.

![Asking about the code in a conversation, then turning it into a task](docs/images/en/feature-chat.gif)

<details>
<summary>Screenshot</summary>

![Chat](docs/images/en/chat.png)

</details>

### Notifications

Waiting for approval, questions, waiting for an answer, waiting for review, and completion collect on the bell icon at the top right, and a desktop notification is shown. Clicking a notification opens that task. They can also go to Slack (see "Integrations" above).

![Opening a notification to go to the card that needs you](docs/images/en/feature-notifications.gif)

<details>
<summary>Screenshot</summary>

![Notifications](docs/images/en/notifications.png)

</details>

### Resolving conflicts

If a merge conflicts, the card becomes a conflict. After the base branch is merged into the task branch, you can have the agent resolve it or fix it yourself in an editor. Either way, the base branch stays unchanged until you merge.

![Having the agent resolve a conflict, then merging](docs/images/en/feature-conflict.gif)

<details>
<summary>Screenshot</summary>

![Resolving a conflict](docs/images/en/conflict.png)

</details>

### Skills and past conversations

When you create a task, you can pick one Claude Code skill (it is passed as `/skill-name`). You can also pick a past Claude Code conversation (session) and start from where it left off.

![Choosing a skill and a past conversation for a new task](docs/images/en/feature-skills.gif)

<details>
<summary>Screenshot</summary>

![New task (a skill and a conversation selected)](docs/images/en/new-task.png)

</details>

### Task scheduler

From the menu in the top bar, switch to "Task scheduler" to manage schedules that create and run a task at a set time (once, hourly, daily, weekly, or monthly) as cards. You can register a kanban task as a schedule directly, and you can create a task from a schedule right away. Schedules run only while the app is open (see [docs/usage.md](docs/usage.md)).

![Registering a daily dependency check, running it now, and seeing the result on the board](docs/images/en/feature-scheduler.gif)

## Requirements

- git
- The CLI of the agent you use (one of Claude Code / Codex CLI / Antigravity CLI / Gemini CLI / Cursor CLI), already signed in
- `gh`, if you use GitHub Issues and PRs (you can also install it from the app)
- A token for each of GitLab, Linear, Jira, and Slack that you connect. Saving tokens needs OS secure storage (on Linux, GNOME Keyring, KWallet, or similar). Issues and MRs in a GitLab repository do not need `gh`

## Install

**Mac / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.sh | bash
```

**Windows** (PowerShell)

```powershell
irm https://raw.githubusercontent.com/kazuya83/worktree-kanban/main/install.ps1 | iex
```

The same commands update to the latest version. You can also update from the app: "Settings" → "App update" → "Update to the new version". If you check "Update automatically when a new version is out", it replaces itself and relaunches when no task is running. For pinning a version, uninstalling, installing from a downloaded file, and the first-launch warning, see [docs/install.md](docs/install.md).

## Usage

1. In "Choose a repository", pick the git repository to work in (you can also clone from a URL or create a new one)
2. In "New task", write the instructions and create it
3. When it is waiting for approval, allow it on the card
4. When it moves to the Review column, check the diff and press "Merge" or "Create PR"

## Documentation

| Document | Contents |
| --- | --- |
| [Screen and usage](docs/usage.md) | How to use each feature: approval, questions, spec check, task scheduler, skills, chat, btw, merge / PR, Issue status, notifications, conflicts, and more |
| [Agents and orchestration](docs/agents.md) | Differences between Claude Code / Codex / Antigravity / Gemini / Cursor, Pipeline and competition |
| [Settings](docs/settings.md) | The settings screen opened from the top-bar menu, and its items |
| [Integrations](docs/integrations.md) | Setting up GitLab, Linear, Jira, and Slack, and what they can and cannot do |
| [Remote control](docs/remote.md) | How to operate the board from another PC over an SSH tunnel, and how to fix a connection that fails |
| [Install](docs/install.md) | Install, update, uninstall, and using a WSL repository on Windows |
| [For developers](docs/development.md) | Run from source, build, release, how the app is built, and tests |
| [Migrate from Vibe Kanban](https://kazuya83.github.io/worktree-kanban/migrate-from-vibe-kanban.html) | What changed at Vibe Kanban, what carries over, and the migration steps |

## License

Released under the [Functional Source License 1.1 (FSL-1.1-ALv2)](LICENSE). You can use, modify, and redistribute it for any purpose except a competing commercial product or service. Each version becomes available under the Apache License 2.0 two years after its release.
