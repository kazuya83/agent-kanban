# Changelog

Notable changes to Worktree Kanban (named Agent Kanban before 0.1.84). This file is a summary, grouped by version range. The notes for every single version, with download links, are on the [Releases](https://github.com/kazuya83/worktree-kanban/releases) page.

Each release that changes the app raises the last number of the version. There is no separate compatibility promise while the version is 0.x.

## Unreleased

### Added

- A guide for moving from Conductor, with the steps to export Conductor Cloud data first (English and Japanese).

### Security

- Tasks created from Issues and tasks requested from Slack, including their subtasks and relay branches, never run with "Allow everything automatically". They run with `acceptEdits` (file edits automatic, commands need approval) even when the project's permission mode is `bypassPermissions`, so a malicious Issue cannot run commands without approval. The card log says so when this applies.

## 0.1.96

### Changed

- Clicking outside the detail panel, on its left, closes it.

## 0.1.95

### Added

- Integrations with GitLab, Linear, and Jira, including self-hosted GitLab and Jira Data Center: create tasks from Issue numbers or URLs, link Issues in PRs and MRs, sync status with the card, write comments back, and handle sub-issues.
- GitLab merge requests: create them, check conflicts and pipeline results, and detect merges.
- Slack integration: notifications for completions, failures, and items waiting for you, and starting tasks from Slack for allowed users only. Nobody can start a task by default.
- Approving and answering from Slack: buttons on notifications for permission checks, agent questions, spec checks, and replies, limited to allowed users. Slack offers Allow only when the full tool input can be shown. Needs "Interactivity & Shortcuts" turned on in the Slack app.
- An "Integrations" section in Settings. Tokens are encrypted with a key from the OS secure storage.

## 0.1.94

### Added

- Antigravity CLI as an agent.

## 0.1.93

### Added

- Checkpoints: restore a task to the point before a Pipeline step or an agent run. Files, Pipeline progress, and the conversation go back together.

## 0.1.92

### Added

- Watch Issues on a schedule and create a card for each new Issue.
- More feature GIFs on the website.

### Changed

- The README and website now lead with chaining agents into flowcharts.
- Improved the detail panel layout.

## 0.1.91

### Added

- A guide for moving from Vibe Kanban (English and Japanese).
- "Agents to use" in Settings: pick the agents you use, so the app no longer assumes Claude Code.

## 0.1.90

### Added

- Ports per task: each worktree gets 10 ports, so parallel development servers do not collide.
- `CHANGELOG.md`, `CONTRIBUTING.md`, and `SECURITY.md`.

## 0.1.89

### Added

- English versions of the documents in `docs/`.

## 0.1.88

### Added

- Setup and cleanup scripts for worktrees, and a run button.

## 0.1.87

### Added

- Send line comments on a diff to the agent.

## 0.1.86

### Added

- Show CI results, and fix failures automatically.

## 0.1.85

### Changed

- The license changed from MIT to [FSL-1.1-ALv2](LICENSE). Each version becomes available under the Apache License 2.0 two years after its release. Versions up to 0.1.84 stay under MIT.

## 0.1.84

### Changed

- Renamed from Agent Kanban to Worktree Kanban. Existing data, SSH keys, and updates keep working.
- Added an MIT `LICENSE` file, and a README, screenshots, a demo GIF, and a website in five languages.

## 0.1.83

### Added

- The app is available in English, Spanish, French, and Simplified Chinese, as well as Japanese.

## 0.1.75 – 0.1.82

### Added

- Task scheduler: create and run tasks at a set time (0.1.80).
- Edit a Pipeline flowchart in natural language (0.1.77).
- Copy button on code blocks (0.1.79).
- Labels on cards for subtasks that a Pipeline creates (0.1.82).

### Changed

- Links open in the default browser (0.1.78).
- Settings moved to a full-screen tab in the top-bar menu (0.1.81).

## 0.1.55 – 0.1.74

### Added

- Choose the model for each task or conversation (0.1.55).
- Projects without git (0.1.56), and tasks that do not change source files (0.1.74).
- Settings per repository (0.1.59).
- Pipelines as flowcharts (0.1.60), several Pipelines in one repository (0.1.67), and names for them (0.1.71).
- Custom agents (0.1.61).
- Progress tab (0.1.64).
- Subtasks that run in parallel or in order, with progress shown, and the option to start a single one (0.1.68 – 0.1.70).

## 0.1.33 – 0.1.54

### Added

- Remote control: operate the board from another PC (0.1.33), over an SSH tunnel (0.1.34), with SSH key creation in the app (0.1.36) and reconnecting to the previous destination (0.1.37).
- Image and file attachments (0.1.39).
- Several repositories open as tabs (0.1.44).
- Chat tab in the task details (0.1.45).
- App update from settings, with an automatic update option (0.1.47).

### Changed

- Release notes list the changes since the previous version under headings (0.1.50).

### Fixed

- Several problems when using chat and repository tabs during remote control (0.1.51 – 0.1.54).

## 0.1.19 – 0.1.32

### Added

- WSL repositories on Windows (0.1.19).
- Codex CLI and Gemini CLI (0.1.21), and Cursor CLI (0.1.24).
- Spec check: work out the details of a vague task in a conversation (0.1.21).
- Combinations of several agents (0.1.21 – 0.1.23), and customizable Pipelines (0.1.29).
- Clone from a URL or create a new repository in the app (0.1.31).

## 0.1.9 – 0.1.18

### Added

- Update the status of GitHub Issues automatically or from the app, with a configurable status field (0.1.9 – 0.1.15).
- Choose between merging directly and creating a PR (0.1.9).
- File tree in the diff tab (0.1.9).
- Continue the conversation after a task finishes (0.1.9).
- Conversations that are not tied to a task (0.1.13), and a notification center (0.1.13).
- Natural-language branch naming rules (0.1.14).
- Resolve PR conflicts in the app (0.1.15).

### Security

- Validated outside input such as branch names, session IDs, and approval tokens (0.1.14).

## 0.1.0 – 0.1.8

### Added

- First release: a kanban board that runs Claude Code in parallel, one git worktree per task, with approval on the card.
- Desktop builds and one-line installers.
- Create tasks from GitHub Issues (0.1.1).
- Send messages to a running agent with btw (0.1.2).
- Pick a past conversation (0.1.3) or a skill (0.1.4) for a task.
- Answer agent questions from the card (0.1.5).
- Push after a merge, and resolve conflicts (0.1.6).
- Tab that shows the work in each worktree (0.1.7).
