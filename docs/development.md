[English](development.md) · [日本語](development.ja.md)

# For developers (running from source, building, how it works)

## Run from source

### Requirements

- Node.js 22 or later (24 recommended)
- git
- The CLI of the agent you use, installed and signed in (one of `claude` from [Claude Code](https://docs.claude.com/en/docs/claude-code), `codex` from Codex CLI, `agy` from [Antigravity CLI](https://antigravity.google/docs/cli), `gemini` from Gemini CLI, or `cursor-agent` from [Cursor CLI](https://cursor.com/cli))

### Start

```bash
npm install
```

```bash
npm start
```

1. Under "Choose a repository", choose the git repository you want worked on (it needs at least one commit)
   - If you do not have it locally yet, the same screen offers **Clone from a URL** (`https://github.com/owner/repo`, `git@github.com:owner/repo.git`, or `owner/repo`) or **Create new** (creates up to a first commit containing only README.md; if you are signed in to gh, it can also create the repository on GitHub and push)
2. Write an instruction under "+ New task" and create it
3. When the card is waiting for approval, press "Allow" on it
4. When it moves to the Review column, check the diff, then press "Merge" (and choose the target branch) or "Discard"

### Build the app

```bash
npm run dist:mac
```

```bash
npm run dist:win
```

```bash
npm run dist:linux
```

The output goes to `dist/`.

### Build and release for all three OSes (on a Mac)

GitHub Actions runs only the tests (`.github/workflows/build.yml`). **Builds and releases are done on a local Mac.** In Claude Code, the `/build-apps` skill does the same thing.

```bash
scripts/build-all.sh
```

This runs the tests → a syntax check of install.sh / install.ps1 → the Mac (dmg), Windows (exe / zip), and Linux (AppImage) builds in one go (for reviews). On an Apple Silicon Mac, **Rosetta 2** is required (the tools that make the Windows installer and the AppImage are Intel binaries).

```bash
softwareupdate --install-rosetta --agree-to-license
```

After merging to main, release with:

```bash
scripts/release-local.sh
```

- If the app's contents have changed since the latest release, it bumps the version by one (for example v0.1.8 → v0.1.9), builds, and creates a GitHub Release. You do not need to edit `package.json`
- Changes to only the README, docs, or tests are not released
- `scripts/release-notes.js` writes the Release description in Markdown, grouping the commits since the previous version into new features and improvements, bug fixes, documentation, and development and build (it also adds a download table per OS and a compare link). `/release` (the automatic post-merge build) produces the same description
- To make a bigger jump such as 0.2.0, set `version` in `package.json` to that number, get it into main, then run the script
- With `--dry-run`, it only prints the next version and whether it would release

The install commands always install the latest Release.

### Build automatically after a merge

Run this once. After that, each time Worktree Kanban merges a task into main (when the merge message starts with `Merge agent task:`), `/build-apps` runs in the background.

```bash
git config core.hooksPath .githooks
```

- `.githooks/post-merge` runs `scripts/after-merge-build.sh` in the background. The merge itself finishes right away
- It creates a temporary worktree (branch `build-apps/<sha>`) from the merged main and asks an agent to run `/build-apps review` (the tests and the three OS builds). If something fails, the agent fixes install.sh / install.ps1 and the like. It uses the first of `claude`, `codex`, `agy`, `gemini`, `cursor-agent` that it finds (set `AFTER_MERGE_AGENT` to choose; agents other than Claude Code run without permission prompts)
- The built files are copied to `dist/` in the folder where main is checked out
- If anything was fixed, it commits and builds again to confirm. If that passes, it merges into main and pushes to `origin/main`. If nothing was fixed, it neither merges nor pushes
- **When the build passes, it publishes a GitHub Release right away.** It uses the built files as they are and does not build again. The version number and whether to release are decided by `scripts/next-version.js`, the same as `scripts/release-local.sh` (changes to only the README, docs, or tests are not released)
  - It does not release if the built commit is not on `origin/main` yet (not pushed), or if that version is already published
  - Set `AFTER_MERGE_NO_RELEASE=1` to skip releasing. You need to be signed in to `gh`
- If something fails, conflicts, or main has uncommitted changes, it neither merges nor publishes automatically. It tells you with a macOS notification and leaves the branch and worktree in place
- Only one runs at a time. If another merge comes in while it is running, it runs once more when it finishes
- **Progress**: macOS notifications tell you in this order: "1/4 Started tests and build" → "2/4 Something was fixed, so building again" (only if something was fixed) → "3/4 Build OK" → "4/4 Checking whether to publish a Release" → "Finished: …" (the URL of the published Release, or why it was not published). The notification text itself is in Japanese
  - `scripts/after-merge-build.sh --status` shows whether it is running, the current stage, and past results (the latest 10; the data is in `.git/build-apps/status` and `.git/build-apps/history.log`)
- Detailed logs go to `.git/build-apps/logs/`. To run it by hand, run `scripts/after-merge-build.sh` (add `--force` to run it even if it has already run on the same main)
- In Claude Code, asking for `/release` (or `/build-apps release`) runs this flow on the spot after confirming with you (build → fix → merge and push → Release)
- To stop it, run `git config --unset core.hooksPath`

## How it works

```
Electron main process
 ├─ AgentManager … creates a git worktree per card and starts claude -p --output-format stream-json
 │                  reads the JSON on stdout and updates logs, state, and cost
 └─ PermissionServer (HTTP on 127.0.0.1, with a token)
        ▲
        │ asks for approval (waits until the user presses a button)
 permission-mcp.js (stdio MCP server)
        ▲
        │ --permission-prompt-tool mcp__agent_kanban__approve
 claude (runs inside each worktree)
```

- Approvals are received through Claude Code's `--permission-prompt-tool`. Only actions not allowed automatically by the permission mode or `--allowedTools` reach the app
- `MCP_TOOL_TIMEOUT` is set long so that waiting for approval does not time out
- When an agent finishes, the changes in its worktree are committed to its branch automatically
- Board data is stored in `board.json` in Electron's userData folder

### Integrations

The guide for users is [integrations.md](integrations.md).

- `src/trackers/index.js`: registers providers and holds the shared logic. The shape of a provider is described in the comment at the top of this file. To add a service, write `src/trackers/<id>.js` and add it to `BUILTIN` at the end. Leave out the features it does not have
- `src/trackers/github.js`, `gitlab.js`, `linear.js`, `jira.js`: issue tracker providers. GitHub uses the existing `gh` code, and the others call their APIs through `src/trackers/http.js`. A provider with `createMergeRequest` and `mergeRequestState` (GitLab) replaces `gh` for repositories whose origin matches
- `src/slack.js`: the Slack settings, posting notifications, and receiving through Socket Mode. It is not an issue tracker, so it sits outside `src/trackers`
- `src/secrets.js`: token storage. Tokens are encrypted with Electron's `safeStorage` and saved in `secrets.json` in userData. They are read only in the main process, right before they are sent to their service, and are never passed to the renderer, remote clients, logs, or agent environment variables
- `src/trackers/http.js`: API calls. It is https by default, does not follow redirects (3xx), and removes tokens from error messages

## Development

```bash
npm test
```

The tests use a fake claude (`test/fake-claude.js`). They run through worktree creation, approval (via MCP), the concurrency limit, follow-up instructions, merging, discarding, and stopping.

## What keeps the old name

After the rename from Agent Kanban to Worktree Kanban, the following keep the previous name so that existing users can carry on as they are.

- The data location (the `agent-kanban` folder in userData, fixed in `main.js`), the SSH key (`agent-kanban_ed25519`), the Pipeline file format, and the appId
- Release files under the previous name (`agent-kanban-<version>-…`). Versions from before the rename cannot update themselves without these files (`scripts/legacy-assets.sh`)
- The installer's `AGENT_KANBAN_VERSION` setting and Linux's `~/.local/bin/agent-kanban` (versions from before the rename launch through it after updating)

To retake the screenshots and GIFss, see [scripts/capture/README.md](../scripts/capture/README.md).

---

[← Back to README](../README.md)
