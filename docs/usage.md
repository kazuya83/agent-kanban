[English](usage.md) · [日本語](usage.ja.md)

# Screen and usage

This is the detailed guide to each feature. How to choose agents, and Pipeline and competition, are in [agents.md](agents.md). Settings items are in [settings.md](settings.md).

## Move between repositories with tabs
The repository area at the top left is a set of tabs, and you can keep **up to 3** repositories open.

- Click a tab to switch to that repository's board
- The "+" on the right opens a repository in a new tab (choose from recently opened, a folder, a clone, or a new repository). If 3 are open, close a tab first
- Click the current tab again to replace its repository with another
- Close a tab with its "×". Closing or switching does not stop tasks running in that repository. Other tabs show the number of running tasks (blue) and tasks waiting for you (yellow)
- The base branch setting is remembered per repository and comes back when you switch tabs. Open tabs are still there at the next launch

## Use a folder not managed by git (video production and so on)
For work that is not code (making videos or documents, for example), you can open a folder that is not managed by git as it is.

- If you choose a folder that is not a git repository under "Choose a repository", it opens as a folder without git (this works even if git is not installed on the PC). The same goes for folders on a remote control host and in WSL
- If you choose "not managed by git" under "Source control" in "Create new", only an empty folder is created, without `git init` (it cannot be created on GitHub)
- Tasks do not create a worktree and run **directly in that folder**. They run in parallel up to the concurrency limit, so tasks touching the same files at the same time can collide
- The Diff and worktree tabs, merge, PR, and conflict resolution do not appear. When a task is finished, check the folder's contents and press "Mark done". "Mark done" appears on the card in the Review column, at the top of the detail panel, and at the end of the chat and log (it does not appear while you are in the middle of answering a question or spec check). "Discard" does not restore the folder's files
- Competition (several agents solving the same task) cannot be used, because the candidates cannot have separate working locations. Pipeline can be used

## Tasks that do not change source (just generating SQL, for example)
You can also create tasks that end without changing source code, such as only writing MySQL SQL or only looking something up.

- Under "New task", check "**Do not change source (lookup or generating SQL only)**". The card shows "No source changes"
- No worktree or branch is created; the task runs in the repository folder as it is (it can read the code to look things up)
- The agent is told not to change source and to write what it produces in a code block in its reply. Claude Code runs with its file-editing tools (Edit, Write, and so on) blocked, and commands are confirmed on the card every time regardless of the permission mode in Settings (with "Plan only", that mode applies). Codex / Antigravity / Gemini / Cursor run in a read-only plan mode
- The SQL or other output appears in the reply on the "Chat" tab. Once you have checked it, press "Mark done" (the same as tasks in a folder not managed by git). Diff, merge, and PR do not appear
- Competition and Pipelines with parallel paths cannot be used. The task cannot be split into subtasks either

## Drag cards between columns
You can change a card's column (state) by drag and drop on the board. This changes only the state, without waiting for a merge or PR.

- Todo → Running: starts the task
- Review → Done: marks it done without merging (the worktree and branch are kept, so you can bring it back later and continue; the Issue's Status in Projects becomes Done)
- Done → Review: brings back a task you marked done (a task whose worktree was cleaned up by a merge or PR cannot be brought back; use "Create a fix task" instead)
- Running tasks, conversations, and parent tasks with subtasks remaining cannot be moved. Merges and PR merges mark tasks done as before

## Approve on the card
A card waiting for approval glows yellow. Check the command it is about to run and press "Allow / Deny / Always allow" right there.

## Detail panel (waiting for approval)
Opens when you click a card. You can check the full input and write a reason for denying to pass on to Claude. The log streams in real time.

## Worktree scripts (setup, cleanup, run)

Under "Branches and landing" in Settings, you can write three scripts per project. They are saved only on this machine and are not added to the repository. All of them run in the worktree folder, and nothing happens if they are empty.

- **Setup**: runs right after the worktree is created, before the agent starts (`npm install`, copying `.env`, and so on). If it fails, the agent does not start and the task ends in an error. If you fix it and retry, it runs again from setup. While it is running, you can stop it with "Pause"
- **Cleanup**: runs just before a worktree is removed by a merge, PR, or discard. If it fails, or has not finished after 5 minutes, a warning is logged and the worktree is removed anyway
- **Run**: a command for checking by hand, such as a development server. It never starts automatically

The buttons on the "worktree" tab in the detail panel start and stop the run script, and let you run setup and cleanup by hand (running cleanup by hand does not remove the worktree). Output appears there too. Only one script can run at a time per task. The run script is stopped when the worktree is removed and when the app quits.

Scripts run in sh / bash on macOS, Linux, and WSL, and stop at the first line that fails. On Windows, the lines are joined with `&&` and run in cmd. The following environment variables are available.

| Environment variable | Contents |
| --- | --- |
| `WORKTREE_KANBAN_ROOT` | The repository folder (for example `cp "$WORKTREE_KANBAN_ROOT/.env" .`) |
| `WORKTREE_KANBAN_WORKTREE` | This task's worktree folder |
| `WORKTREE_KANBAN_BRANCH` | This task's branch |
| `WORKTREE_KANBAN_BASE_BRANCH` | The base branch |
| `WORKTREE_KANBAN_TASK_ID` | The task's ID |
| `WORKTREE_KANBAN_PORT` | This task's port (see "Ports per task" below) |
| `PORT` | The same number as `WORKTREE_KANBAN_PORT` |

### Ports per task

A worktree only separates files, so running the same development server in parallel would normally make the ports collide. When a worktree is created, each task therefore gets 10 consecutive ports from the 20000–29999 range (`WORKTREE_KANBAN_PORT` through +9). Ports used by other apps are avoided. The number stays the same across app restarts and is freed when the worktree is removed. The current number is shown on the "worktree" tab in the detail panel.

The agent receives the same environment variables as the scripts, so a server that reads `PORT` does not collide when the agent starts it either. Servers that read `PORT` (Next.js, Express, and so on) work as they are. For servers that do not, pass the number in the run script.

```sh
# Vite (a second server uses +1)
npm run dev -- --port "$WORKTREE_KANBAN_PORT" --strictPort &
API_PORT=$((WORKTREE_KANBAN_PORT + 1)) npm run api
```

In cmd on Windows, write `%WORKTREE_KANBAN_PORT%`.

## Detail panel (diff and merge)
For a card in the Review column, you can look at the diff from the base branch before merging. You can merge into any branch you choose (or create a new one).

## Answer questions from the agent
Multiple-choice questions can be answered on the spot (multiple selection and free text under "Other" are supported).

When a question comes as text, the card becomes "Waiting for an answer", and you can answer in the box below.

![Waiting for an answer](images/en/awaiting.png)

## Pin down the spec through dialogue when a task is not specific enough
When you start a new task (written by hand or created from an Issue), the agent first reads the instructions and the repository, and judges whether the spec is settled enough to start development.

- If it is, development starts right away
- If not, it stops without changing files. The card turns light blue with "**Spec check**" and shows that development cannot start because the spec is not settled (🔔 and desktop notifications also appear). The agent's questions appear in the detail panel, and you answer in the box below
- Each time you answer, the agent judges again and asks further questions if needed. Once the spec is settled, it summarizes the decided spec and starts development in the same conversation
- During the spec check, the Issue's Status in Projects does not move to review (it stays In progress)
- You can turn this off with "If a new task is not specific enough, talk with the agent to pin down the spec before development starts" in Settings

## Run tasks at a set time (Task scheduler)

Press the menu button (three lines) at the left end of the top bar to switch between "Kanban", "Task scheduler", and "Settings". Kanban is the usual board. For Settings, see [settings.md](settings.md).

Task scheduler shows the schedules of the repository you have open as cards. Each card shows the task name and the last run date ("Not run yet" if it has not run). Open a card to see the repeat setting, next run time, instructions, agent, skill, and run history. "Open card" in the history takes you to the kanban card created at that time.

**There are two ways to register a schedule.**

- Register a new one from "New schedule" in Task scheduler
- From "Add to schedule" in a kanban task's detail panel, register by copying that task's contents (title, instructions, skill, agent, model). Pipeline, competition, and custom agent choices carry over too. Attachments are not copied. If the original Pipeline or the like no longer exists and cannot be chosen, the edit screen shows a warning

**Repeat** can be once, every N minutes (1–1440), hourly, daily, weekly (several weekdays can be chosen), or monthly. Times are local to the PC running the app. If you choose a day that does not exist in a month, such as the 31st with monthly, it runs on the last day of that month.

**What you can do from an open card:**

| Button | What it does |
|---|---|
| Run now | Creates a task on the kanban and starts it right away. The next scheduled run does not change |
| Create the task only | Creates a task on the kanban without starting it. While that card stays in Todo, the next scheduled runs are skipped |
| Edit | Changes the instructions, repeat setting, and so on |
| Pause / Resume | Nothing runs while it is paused. For a "Once" schedule that has already run, change the date and time with "Edit" before resuming |
| Delete | Deletes the schedule. Tasks already created remain |

At the set time, it creates an ordinary card and starts it. Approvals, the concurrency limit, and review after that are the same as for a task you created by hand. So that it does not stop when nobody is watching, no spec check is done.

**Schedules run only while the app is running** (the OS scheduler is not used). Schedules of repositories not open in a tab also run. During remote control, they run in the host app.

Because they run unattended, they do not run in the following cases. The outcome is kept in the run history.

| Situation | What happens |
|---|---|
| More than 10 minutes late (the app was closed or the PC was asleep) | Skips to the next run. Only schedules with "If the time has passed, catch up once after launch" checked run once |
| The previous card is still in Todo, queued, or running | Skips this run (the same task does not pile up) |
| It cannot run, for example because its Pipeline was deleted | Recorded as a failure with a notification, and moves to the next run. Pressing the notification opens Task scheduler |
| The repository folder is gone | Recorded as a failure with a notification, and the schedule is paused. When the folder is back, open that repository and "Resume" |

### Create a card for each new Issue (Issue watch)

Choose "Issue watch" under "Type" in a schedule, and at each repeat it checks the open GitHub Issues and creates one card per new Issue. "Repeat" sets how often it checks ("Every N minutes", or hourly, daily, and so on). This uses `gh`. Without `gh`, it reads through the GitHub API (public repositories only).

| Setting | What it does |
|---|---|
| Labels | Comma-separated. Only Issues with all of them are included. Leave empty for no filter |
| Author | Only Issues created by this person are included. `@me` is the user signed in to `gh`. Leave empty for no filter |
| What to do with created cards | Choose "Just place them in Todo" or "Start automatically" |
| Additional instructions | Optional. Sent to the agent along with the Issue |

- **Which Issues count**: Issues that already exist at registration are not included. Only Issues created afterward become cards (including ones that receive the target label later)
- **One card per Issue**: an Issue that already became a card, or that already has a card, does not get another. Deleting a card does not recreate it
- **Cards per check**: up to 10 cards per check. The rest are created next time, oldest first
- **Spec check**: cards placed in Todo get the usual spec check when started. Cards started automatically do not
- **When a check is late**: Issues created while the app was closed or the schedule was paused are picked up at the next check
- **Run history**: only card creation and failures are kept. A check with no new Issues only updates "Last checked" in the detail view. If reading keeps failing, you are notified only the first time
- **Check now**: "Check now" in the detail view checks without waiting. Cards are handled according to the schedule's setting

> The Issue body and comments become instructions to the agent as they are. Anyone can write them in a public repository, so narrow the target by label or author when you choose "Start automatically". Only people with write access can add labels.

## Split work into subtasks
A large task can be split into several subtasks that separate agents work on in parallel or in order.

- **How it works**: one branch is created for the parent task, and subtasks run in worktrees and branches split from it. A finished subtask is merged into the parent branch. When all subtasks are "Done", the parent agent does the final pass (checking the seams and running tests), then sends the task to review (if nothing was merged, it skips the final pass and leaves things as they are). Review, merge, and PR happen on the parent task
- **In order or in parallel**: for each subtask, the agent looks at the contents and decides which subtasks must finish first. When running automatically, once the earlier subtasks are merged, the following ones start from the parent branch (with the earlier changes in it). This order is a guideline and does not block starting a single subtask (below)
- **Start a single subtask**: the "Start" button on the "Subtasks" tab (or dragging to the "Working" column) starts just that subtask without running the others. If the parent has not started, only the parent branch is created and the parent agent does not run (no order is decided either). A subtask started individually stops at review when it finishes, so check the diff and press "Merge in" to merge it into the parent branch. To run all the rest, press "Run the rest automatically"
- **Change state by drag and drop**: on the "Subtasks" tab, subtasks are arranged in "Not started / Working / Review / Done" columns, and you can drag them to change state. A merge does not by itself change the state (one started individually stays in the Review column even after being merged in, so move it to Done)
  - Not started → Working: starts just that subtask / Not started → Done: marks it done without starting
  - Review → Done: one already merged in becomes done. One not yet merged in is marked done without merging (that subtask's worktree and branch are removed)
  - Done or merged in → Not started: redo it (changes merged earlier stay on the parent branch) / Done → Review: bring back a merged one
  - A subtask that is working cannot be moved, and none can be moved while the parent is running
- **Proposals from the agent**: during the spec check (above), if the agent decides a task is large enough to split, the card becomes "**Subtask proposal**". At the end of the "Chat" tab, edit the subtasks' names and instructions, then choose to use subtasks or to continue without splitting. A task created from an Issue can also choose to create sub-issues under the parent Issue in its service (after a confirmation)
- **Decide by hand**: on the "Progress" tab of a task that has not started, add subtasks with "Edit subtasks". After that, edit them on the "Subtasks" tab (the agent decides the order when the task starts)
- **Sub-issues**: when you create a task from an Issue that has open sub-issues, each becomes a subtask. The PR or MR body includes a line for the parent Issue and for each merged sub-issue (`Closes #…` on GitHub). This works with GitHub, GitLab, Linear, and Jira ([integrations.md](integrations.md))
- **How to merge**: before starting (in the subtask editor or the proposal form), choose "Merge into the parent branch automatically" or "Merge after I check it". If you choose to check, a finished subtask becomes "Waiting for review", so look at the diff and press "Merge in". The default can be changed under "Task defaults" in Settings
- **Conflicts**: if subtasks' changes collide, the parent agent resolves them automatically and moves on (if it cannot, ask again from the "Conflict" area or fix it yourself, as with an ordinary conflict)
- **Progress**: only the parent card appears on the board, showing something like "Subtasks 2/4 done" and a bar divided by the number of subtasks. While subtasks are running, the parent appears in the "Running" column. The "Progress" tab in the detail panel shows overall progress (the share done; the numbers done, working, and not started; the subtasks running now; and the cost of the parent and subtasks combined). A task with subtasks gets a "Subtasks" tab showing each subtask's state, assignee, cost, and the report for merged ones. Click a card on the "Subtasks" tab to open that subtask's details in a modal. A running subtask (Working or Review) shows the same contents as a task's detail panel (chat, log, diff, progress and TODO, answering questions, follow-up instructions), and closing it returns you to the parent's "Subtasks" tab. A subtask that has not started or has finished shows what to do, the report, and whether it was merged (one not started can also be started from there, and "Edit" changes its name and contents; the subtask then runs with those contents)
- Pipeline, competition, and tasks in folders not managed by git cannot be split into subtasks
- Cards for branches created automatically by a Pipeline's Parallel get a "Subtasks" label on the board (even if the step's name does not include "subtask")

## Choose a skill
Press "⚡ Choose a skill" to see the available skills as cards. You can choose one. The chosen skill appears as a label above the input box.

![Choosing a skill from cards](images/en/skill-picker.png)

## Attach files to instructions
The input boxes for "New task" and "Conversation" (both when starting and for later messages) accept images, PDFs, text, and other files.

- There are three ways to attach: **paste** into the box (⌘V / Ctrl+V; screenshots can be pasted directly), **drag and drop**, and the "Attach files" button below the box
- Attached files are listed below the box (remove them with ×). Up to 10 files, 20 MB in total
- Attachments are saved in an app folder outside the working folder (worktree or repository). The saved location is added at the end of the instruction, so any agent can read them from there
  - Claude Code receives images (PNG / JPEG / GIF / WebP, up to 3.5 MB) directly attached to the message
  - Codex / Antigravity / Gemini / Cursor, and files other than images, are read from the saved location
- Files attached from a remote control client are sent to the host and saved there
- The names of attached images and files appear in the log under your instruction. For a task that has not started, they also appear in the editor on the "Progress" tab. Discarding a task also deletes its attachments

## Create from an Issue
Press "+ New task", choose "Create from a GitHub Issue" in the tabs at the top, and choose an Issue number and a conversation (session). If you enter several numbers, each becomes a card and they run in parallel. The tab shows the service chosen under "Issue sync" (for GitLab, Linear, and Jira, see [integrations.md](integrations.md)).

## Resolve conflicts
When a merge conflicts, you can ask the agent to resolve it or fix it yourself. If the merge target moves on after a PR is created and the PR conflicts, you can resolve it the same way in the app and update the PR.

## Talk to an agent without a task (💬 Conversation)
Press "💬 Conversation" at the top to start a conversation not tied to a task (questions about this repository, lookups, advice, and so on). You can choose which of your agents to talk to. Conversations do not appear in board columns; open the list from the "💬 Conversation" button (the number on the button is the number of conversations, and a yellow count appears when any are waiting for your reply). Choose a conversation to open it in a modal at the center of the screen, and continue in the box below.

The agent's replies and your instructions in the log are rendered as Markdown (headings, lists, tables, code blocks, and so on).

- No worktree or branch is created; it runs in the repository folder as it is. It does not commit, merge, or create PRs
- Because it works on your local working files, file changes and commands are confirmed on the card every time (when the permission mode in Settings is "Plan only" or "Allow everything automatically", that mode applies)
- It does not count toward the concurrency limit, so you get a reply right away even when tasks are backed up
- When you want work done, press "📝 Make a task" to create a task that runs in a worktree as a continuation of the conversation (the conversation itself stays). Between Claude Code agents the conversation itself carries over. In other cases (a Codex / Antigravity / Gemini / Cursor conversation, or a task on a different agent), the exchange is passed along with the first instruction

## Switch conversations (sessions)
Under "Conversation" in the detail panel, choose which conversation the next run uses. If a task continued from an existing conversation, it shows where it came from.

## See progress
The "Progress" tab in the detail panel shows how far a task has come.

- State, start time and elapsed time, agent, and cost
- TODOs written by the agent (TodoWrite on Claude Code, TODO lists on Codex, Gemini, and Cursor; Antigravity does not report TODOs, so the list stays empty), grouped into done, in progress, and upcoming, with a bar showing the share done. A Pipeline shows the current step's TODOs, and shows each branch's TODOs while waiting for parallel branches
- For a Pipeline, the flowchart from Settings is drawn as is, with steps colored as finished (green), running (blue), stopped (orange), and upcoming. Lines already passed are green, and the line toward the current step animates in blue. Zoom the flowchart with the buttons at the top right, or with ⌘ (Ctrl) + scroll or a pinch ("Fit" fits it to the frame's width). Below it are each step's time, cost, judgment, and the report passed to the next step. When the task is stopped in review or has failed, "Restart from here" on a step returns to just before that step's first run ([Restore an earlier point](#restore-an-earlier-point))
- Recent work (tool calls and replies), newest first. See "Log" for details
- For a task that has not started, you can edit the title and first instruction here (after it starts, the instruction can be seen at the top of "Chat")

For a competition task, the list of candidates, "Adopt", and "Compare" also appear here. For a subtask, the parent task and how it merges appear. For a task split into subtasks, overall progress appears, and each subtask's state and actions are on the "Subtasks" tab.

## Restore an earlier point
This is separate from moving a card between columns ("Move back", from Done to Review). Here, the work itself returns to a recorded point.

You can restore both a **Pipeline step** and a **run of the agent**, with the same action. The point is just before that run started. "Restart from here" on a step returns to just before that step's first run. After restoring, the instruction from that point is sent again and the task starts right away.

What returns is the **files**, the **Pipeline progress**, and the **conversation**. Changes after that point are discarded and not kept. The restore cannot be undone. Money already spent is not refunded. Logs after that point disappear, and the history from that point onward disappears too (it is recorded again once work starts). Files git ignores, such as `node_modules`, stay. Uncommitted changes you made by hand are included in the point taken just before the agent next starts.

A point is recorded each time, just before the agent starts (up to 100, oldest first; older ones are dropped past that). The following runs are not recorded:

- A conversation after the task is done
- A run that resolves a conflict
- Resuming an interrupted task
- A task in a folder not managed by git

### Where to restore from
- In the workflow in the detail panel, "Restart from here" appears when that step has a first run
- The "History" on the Progress tab lists each run newest first, and "Return here" goes back to just before that run
- The confirmation dialog says that later changes are discarded and cannot be undone, and that work starts right away
- When you cannot restore, the button is disabled and the reason is shown

### When you cannot restore
You cannot restore in the following cases. If restoring the files fails partway, the card stays as it is and an error is shown (the same happens when the recorded point has no files to restore).

- Any state other than review or failed (running, queued, done, and so on)
- Waiting for parallel branches to finish, or a conflict is present
- The task has subtasks that have started
- The task is done, already merged, or has no worktree
- A PR has been created
- On a parallel branch, the parent task has already merged it
- A folder not managed by git (the files cannot be restored)

Steps on a parallel branch cannot be restored from the parent task after the join (the branch card has been cleaned up). Only the parent's points are shown.

### How the conversation is handled
How the conversation is restored differs by agent.

- When that point has no conversation: a new conversation starts. The first run of a Pipeline step is always this
- When the run was about to continue another conversation: the source conversation is left unchanged. Only which conversation is used returns to that point
- Claude Code: if no other card is using that conversation, the conversation file is at least as large as it was at that point, and the boundary is a line break, the file is truncated to that size and the same conversation continues. If those conditions are not met, a new conversation starts, as in the next case
- Codex / Antigravity / Gemini / Cursor (and Claude Code when the conditions are not met): a new conversation starts, and a handoff built from the instructions and replies in the log (up to 8,000 characters) is placed before the instruction

## btw (send a message while running)
From the "btw" tab of a running card, you can send a message to Claude without stopping its work. Once received, it shows "Delivered".

![btw tab](images/en/btw.png)

## Choose the merge target
Press "Merge…" to choose the target branch. You can also create a new branch, or keep working on the task after the merge.

![Dialog for choosing the merge target branch](images/en/merge-dialog.png)

## Choose a direct merge or a PR
Under "How to land after review" in Settings, choose per project between **Create a PR** (push to origin and `gh pr create`; the default) and **Merge directly** (local `git merge`). A project opened for the first time starts with "Create a PR" (repositories with no origin or not on GitHub or a connected GitLab, and folders not managed by git, start with "Merge directly"). With PRs, the button on a card in review becomes "Create PR…", where you set the base branch, title, and body (a task created from an Issue gets `Closes #number`). If you press it again after changes from a follow-up instruction, it pushes to the same PR and updates it. Creating a PR requires gh to be installed and signed in. If origin belongs to a connected GitLab, the app creates an MR with the API instead of `gh` ([integrations.md](integrations.md#gitlab)).

The app checks the state of created PRs on GitHub every minute. **When a PR is merged, the task becomes "Done" automatically** (the worktree and local branch are also cleaned up). However, if the worktree has changes not in the PR (uncommitted changes or unpushed commits), nothing is removed and the task stays in review.

## Update Issue status automatically
A task created from an Issue automatically changes the **Status in GitHub Projects** for that Issue to match the card's column. Issues in GitLab, Linear, and Jira follow the same columns, though what changes differs by service ([integrations.md](integrations.md)). The rest of this section is about GitHub.

| Card | Status |
| --- | --- |
| Running or queued | In progress |
| Review (including errors) | In review |
| Merged and done | Done |

- When a PR has been created (and not merged yet), it stays In review. When the app finds that the PR was merged, it marks the task done and sets Done
- Status options are found by name (`In Progress`, `🏗 In progress`, `in-progress`, `進行中`, and so on are treated as the same). A Project with no matching option is left unchanged
- Under "Issue sync" in Settings, you can set the **name of the field to change** (`Status` if empty) and the **option name to use for each column** (for example Review → `QA`, Done → `Released, Shipped`). A column you set uses only options with those names, and an empty column is found automatically by name as usual
- gh needs the **project scope**. Press "Add the Projects scope" under the same "Issue sync" to add it in the browser (or run `gh auth refresh -h github.com -s project` in a terminal)
- You can also turn this off with "Update Issue status automatically" in Settings

## Notifications (🔔 at the top right)

Events such as waiting for approval, questions, waiting for an answer, waiting for review, failures, and completions collect in the bell at the top right (desktop notifications also appear). The bell shows the unread count, and pressing a notification opens that task's detail panel. "Mark all read" and "Clear all" are available too. Completions, failures, and items waiting for you can also be posted to Slack ([integrations.md](integrations.md#slack)).

## Keep talking after a task is done, and get skill suggestions
You can send a message from the box below to a task that is "Done" after a merge (or PR creation) and talk about it (questions, lookups, advice, and so on). The task **stays Done**: it does not go back to the Review column and no merge button appears. Without recreating the worktree, the agent answers in the repository folder in **plan mode**, which does not change files (a new conversation starts with the task's instructions and exchange passed to it, and later messages continue that conversation).

If a fix is needed, create a separate task with "🛠 Create a fix task" on the finished task. The new task carries over the original task's exchange (including conversation after it was done).

When a task enters "Done", if there are **tasks with similar work** among earlier finished tasks (similar work keeps coming up), the 🔔 notifications at the top right offer "Similar tasks keep coming up. Turn this into a skill?" (this can be turned off in Settings). This does not happen every time a task finishes. Similarity is decided locally by comparing the titles and instructions of finished tasks in the same repository (Issue boilerplate is excluded; a fix task and its original, and tasks already used for a skill suggestion, are not counted). Pressing "💡 Ask for a skill suggestion" in the notification does not reuse the original task's card. It creates a new conversation card ("💡 Skill suggestion: task name"). The original task's instructions, exchange, and result, plus the similar past tasks, are passed to that conversation. The original task's agent (or the agent selected by default, if that agent is unchecked) reviews the repeated work, suggests 1 to 3 things worth keeping as skills (`SKILL.md`), and asks which to add. Answer in the box below and it creates the skill for you.


## What you can do

- **A card starts working as soon as you create it**: a branch `agent/<name>-<id>` and a worktree (`<repository>.worktrees/<id>`) are created automatically, and the agent's CLI (`claude -p` / `codex exec` / `agy` / `gemini` / `cursor-agent -p`) starts inside it
  - If you write a rule in plain language under "Branch naming rule" in Settings, such as "use `feature/<Issue number>-<short English description>`", the task's agent comes up with the branch name following that rule when the task starts (if the name already exists, `-2` or the like is added; if it cannot decide, the usual name is used)
- **Choose a model per task or conversation**: in the "Model" field of the screens that start "+ New task" (including from an Issue) and "💬 Conversation", choose the model for just that task or conversation (for example `opus` / `sonnet` / `haiku` on Claude Code). The field suggests models often used with the chosen agent. If empty, the default model for that agent in Settings is used. Pipeline and competition run several agents, so they use the models in Settings. The model in use can be seen on the "Info" tab in the detail panel
- **Create tasks from GitHub Issues**: choose the "Create from a GitHub Issue" tab under "+ New task" and just enter a number. The agent's instruction is built from the Issue's title, body, labels, and comments. Enter several, like `12, 15, 18`, and each Issue becomes one card, running in parallel
  - The branch is `agent/issue-12-…`, and commit messages get `(#12)`. Press `#12` on the card to open the Issue page
  - The same screen also lets you choose a conversation (session) and additional instructions
  - Issues are read with **gh (GitHub CLI)**. If gh is not installed, you can install it with "Install gh" on the same screen (Homebrew on Mac, winget on Windows). If you are not signed in, press "Sign in to GitHub"; a browser opens and shows a verification code, which is all you need to enter
  - Public repositories can be read without gh
  - Issues in GitLab, Linear, and Jira work the same way. Choose the service under "Issue sync". They are read with the token you entered under "Integrations", not with `gh` ([integrations.md](integrations.md))
- **Answer questions from the agent**:
  - When a multiple-choice question arrives (AskUserQuestion on Claude Code), the card turns purple with "Question" and an answer form appears. Single-choice questions use radio buttons and multiple-choice ones use checkboxes, and both have a free-text "Other". A single question can be answered by pressing a button on the board's card. "Continue without answering" lets Claude proceed in a reasonable way
  - When Claude ends its reply with a question in text, the card becomes "Waiting for an answer" and the question appears in the detail panel. Write your answer in the box below and it continues the same conversation
  - Both show desktop notifications. The top right of the screen shows how many items are waiting for you
- **Choose a skill**: when creating a task (by hand or from an Issue) and when sending a follow-up instruction in the detail panel, you can choose one Claude Code skill. Skills are chosen from a list of cards, and the chosen skill appears as a label above the input box (remove it with ×)
  - The chosen skill is passed to Claude as `/skill-name` at the start of the instruction
  - The list shows skills from this repository's `.claude/skills/`, your own `~/.claude/skills/`, and installed plugins
  - You can preset "Skill selected by default on a new task" under "Task defaults" in Settings
- **Choose a conversation (session)**: when creating a task, choose a past Claude Code conversation (one from the terminal, for example) to start the task as its continuation. The original conversation stays as it is (`--fork-session`)
  - Under "Conversation" in the detail panel, you can switch the next follow-up instruction between continuing the current conversation, a new conversation, this card's previous conversation, or another existing conversation
- **Delete conversations (sessions)**: from "Sessions" at the top, list Claude Code's conversation records, choose some, and delete them (independently of tasks; only conversations from this repository and its task worktrees appear)
  - Conversations used by running or queued tasks cannot be deleted. If you delete a conversation used by another task, that task starts a new conversation from then on
  - When a task is merged and done, the conversations it used for work are deleted automatically (the original conversation it continued from, and conversations after it was done, are kept). You can turn this off with "When a merge completes the task, delete the Claude Code conversations (sessions) it used for work" under "General" in Settings
- **btw (send a message while running)**: from the "btw" tab of the detail panel, send a message without stopping the agent's work (for example "write tests too" or "don't use that API"). Claude reads it partway through its work and applies it, and it shows "Delivered" once received. A message sent to a queued task is added to the instruction used when it starts
- **Columns move automatically**: Todo → Running (including Queued) → Review (including errors) → Done
- **Approve on the card**: actions that need permission appear on the card as "Waiting for approval". Choose **Allow / Deny / Always allow for this task** right there. Desktop notifications also appear
- **Detail panel**: opens when you click a card. Drag its left edge to change the width (the width is remembered; double-click to restore it). Click an empty part of the board on the left to close it. Its contents are as follows
  - The top two rows: the first is the title (shortened with "…" if it does not fit on one line; hover for the full text), and the second has buttons (start, stop, merge, discard, and so on). The height is fixed. The Pipeline, overall progress, and competition candidates are on the "Progress" tab, the list of subtasks is on the "Subtasks" tab, and interruptions, errors, conflicts, and subtask proposals appear at the end of the "Chat" tab
  - Log: the agent's remarks and tool calls and results stream in real time
  - worktree: the state of the worktree. It shows the flow from base → commits → uncommitted (in progress), a list of touched files (most recently edited first, with change bars), how many commits the base branch has moved since, and the list of worktrees running in parallel in the same repository (updated automatically while running)
  - Diff: changes from the base branch, shown GitHub-style as a file tree (folders) plus per-file diffs with line numbers. Hover over a line and press "+" to write a comment. Comments collect as drafts (you can edit and delete them), and "Send to agent" at the top sends them together as a follow-up instruction, with the file name, line number, and line attached. While the agent is working you can only write them; you can send when follow-up instructions can be sent. Drafts disappear when the app closes
  - Instruction: the first instruction (editable before starting)
  - Follow-up instruction: runs as a continuation of the same session (`--resume`)
- **Merge / Discard**: merge into any branch you like (`--no-ff`), or delete the worktree and branch together
  - Choose the merge target from the list or create a new branch on the spot (the default is the base branch)
  - If the merge target is not checked out anywhere, the merge happens in a temporary worktree, so your local working folder does not change
  - "Keep working on the task after the merge" leaves the worktree and branch in place. For example, you can merge into `develop` to check, then merge into `main` later
  - "After merging, push to origin" pulls in the latest origin, merges, and pushes to `origin/<target>` (so it also shows up on GitHub). If local and origin have diverged, it stops and tells you rather than breaking anything. Push authentication uses your usual git setup (keychain, SSH, and so on)
  - Done tasks cannot be deleted (they stay on the board as a record)
- **Conflict resolution**: when a merge conflicts, the card becomes "Conflict" and the conflicting files are shown
  - "Ask ○○ to resolve it": brings the merge target branch into the task's branch, and the task's agent resolves it while preserving the intent of both changes
  - "Resolve it myself": opens the worktree in its conflicted state. Fix it in an editor and press "Resolved". You can also abort the merge
  - It does not count as finished while markers such as `<<<<<<<` remain. Once it is resolved, just press "Merge again"
  - **PR conflicts**: if GitHub reports a conflict between a PR being watched and its merge target, the card becomes "Conflict" and notifies you. As above, choose "Ask ○○ to resolve it" or "Resolve it myself" to bring `origin/<target>` into the task's branch and resolve it. Then press "Update PR (push)" and the PR's conflict goes away. If you close the notice, you can start again from "Resolve" on the PR row in the detail panel (for a task whose worktree was cleaned up after creating a PR, resolve it on GitHub)
- **Concurrency limit**: cards over the limit become queued and start in order as slots free up

## Notes

- If the merge target branch is checked out somewhere, keep that folder free of uncommitted changes. If there is a conflict, the merge is aborted and you are told
- If you try to quit the app with running or queued tasks, a confirmation dialog appears. "Stop and quit" stops the agents, commits the changes so far to the task branches, and quits
- At the next launch, interrupted tasks get an "Interrupted" badge, and "▶ Resume all" appears above the board. "▶ Resume" on each task also continues work from the same conversation (a task that was queued has its instruction passed again as is). To continue with different instructions, send a follow-up instruction. You can resume the same way after an app crash

---

[← Back to README](../README.md)
