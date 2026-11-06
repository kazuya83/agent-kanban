[English](settings.md) · [日本語](settings.ja.md)

# Settings

Choose **"Settings"** from the menu button (three lines) at the left end of the top bar, and the settings screen opens across the whole area below the top bar.

The list of sections is on the left, and all sections run down the right side. Press a section on the left to scroll to it. As you scroll on the right, the blue bar on the left follows the section you are viewing.

| Group | Sections |
| --- | --- |
| (no heading) | [General](#general), [App updates](#app-updates) |
| This project | [Branches and landing](#branches-and-landing), [Issue sync](#issue-sync), [Permissions](#permissions), [Task defaults](#task-defaults) |
| Agent | [Agents to use](#agents-to-use), [Custom agents](#custom-agents), [Orchestration](#orchestration) |

## How saving works

- Changes are saved together with **"Save"** at the bottom. The screen stays open after saving
- **"Undo"** throws away unsaved changes and returns to the saved values
- Only changes to the list of Pipelines are saved on the spot
- If you move to another screen or tab without saving, your changes are discarded without asking
- When the app starts, it returns to whichever of Kanban or Task scheduler you had open, not to the settings screen

Sections under "This project", and items marked "per project" below, are remembered for each project (repository). Switching tabs at the top switches to that project's settings. Tasks of other projects running in the background also use their own project's settings. A project opened for the first time starts from the defaults. All other items are the same across projects.

Projects that were in use before this version keep their existing settings (including how they land changes).

## General

| Item | Description |
| --- | --- |
| How many run at once | 1 to 10 |
| Offer to make a skill when similar work keeps coming up | When a task finishes, if similar work keeps appearing among earlier finished tasks, a notification asks you (the bell at the top right) |
| Delete conversations after a merge | Deletes the Claude Code conversations used for work by a task finished with a merge (also when its PR is merged). The original conversation it continued from is kept (on by default) |

## App updates

Shows the current version and whether a new one is available. You can also open this by pressing the update notice next to the version at the top left. See [install.md](install.md) for details.

## Branches and landing

| Item | Description |
| --- | --- |
| Base branch | Where worktrees are created from. It is also the default merge target. If empty, the checked-out branch is used |
| How to land after review | **Create a PR** (default) or **Merge directly**. Repositories with no origin or not on GitHub, and folders not managed by git, start with "Merge directly" |
| Branch naming rule | The agent comes up with branch names that follow a rule written in plain language |

"After merging, push to origin", chosen in the merge dialog, is also remembered per project.

## Issue sync

| Item | Description |
| --- | --- |
| Update Issue status automatically | Changes the Status in GitHub Projects to match the task's column (the field and option names are also per project) |

See [usage.md](usage.md#update-issue-status-automatically) for details.

## Permissions

| Item | Description |
| --- | --- |
| Permission mode | `acceptEdits` (file edits are automatic, commands need approval) is recommended. With `default`, every action is approved on the card |
| Tools to allow Claude Code from the start | Passed to `--allowedTools`. Example: `Bash(npm test:*), WebSearch` |

## Task defaults

| Item | Description |
| --- | --- |
| Skill selected by default on a new task | The skill already selected when you open "+ New task" (for both plain language and Issues) |
| Pin down the spec | If a new task is not specific enough, the agent asks questions to pin down the spec before development starts (on by default) |
| When a subtask finishes | The default for whether to merge into the parent branch automatically or after you check it. Each task can change this before it starts |

## Agents to use

| Item | Description |
| --- | --- |
| Agents to use | Check the ones you use out of Claude Code / Codex CLI / Antigravity CLI / Gemini CLI / Cursor CLI. Only checked agents can have the items below set, and only they can be chosen for tasks, conversations, Pipeline, and competition |
| (per agent) Command path | Set the full path when the command is not found after launching from Finder or the like |
| (per agent) Model | Passed to `--model` / `-m`. If empty, the default model is used |
| Agent selected by default | The agent already selected when you open a new task or conversation (one of the agents to use; if Pipeline or competition is chosen under orchestration, that is selected for tasks instead) |

## Custom agents

Give a base agent (CLI) and model a name, icon and color, description, and behavior instructions (per project; see [agents.md](agents.md)).

## Orchestration

Settings for Pipeline and competition. For Pipeline, use "Edit flowchart" to build a flowchart that connects steps, branches (if), loops, parallel paths, and joins (each project can have any number of them, and you choose one when creating a task; `.json` and zip export and import are here too; see [agents.md](agents.md) for details).

## Settings found elsewhere

Remote control (RC) settings are not in the Settings menu. They are under **"RC settings"** at the top ([remote.md](remote.md)).

---

[← Back to README](../README.md)
