[English](integrations.md) · [日本語](integrations.ja.md)

# Integrations

Besides GitHub, you can connect GitLab, Linear, Jira, and Slack. GitHub works as it always has: it uses `gh`, and you do not need to set up a token.

## What you can do

| | GitHub | GitLab | Linear | Jira |
| --- | --- | --- | --- | --- |
| Input for a task | `12`, `12, 15, 18` | `12`, `#12`, `group/project#12`, an Issue URL | `ENG-123`, an Issue URL | `ABC-123`, an issue URL |
| Line in the PR / MR body | `Closes #12` | `Closes #12` | `Ref ENG-123 <URL>` | `ABC-123 <URL>` |
| What status sync changes | Status in GitHub Projects | Labels, and whether the Issue is open | Workflow state | Transition |
| Comments on the Issue | No | Yes | Yes | Yes |
| Sub-issues | Sub-issues | Child tasks (related Issues on versions without them) | Sub-issues | Subtasks |
| Creating and checking PRs / MRs | With `gh` | With the GitLab API | Left to the repository's host | Left to the repository's host |

Linear and Jira only handle issues. You create the PR or MR on the repository's host (`gh` for GitHub, the API for GitLab) or merge directly.

Slack is not an issue tracker. It is for posting notifications and starting tasks from Slack ([below](#slack)).

These work the same way for every service.

- **Instructions**: the agent's instructions are built from the Issue's title, body, labels, and up to the 20 newest comments. Each Issue becomes one card
- **Status sync**: a running or queued card means in progress, review or an error means in review, and a card that was merged or marked done by hand means done. If you only created a PR or MR, it stays in review until the app finds that it was merged
- **Comments**: the app comments on the Issue when the task starts, when a PR or MR is created, and when the task is done. Turn this off with "Comment on the issue when a task starts, a PR is created, and the task is done" under "Issue sync"
- **Sub-issues**: when you create a task from an Issue, each open sub-issue becomes a subtask. When you accept subtasks proposed by the agent, you can also create sub-issues in the service, after a confirmation
- **Failures**: if status sync or a comment fails, the task keeps going. The reason appears in the card's log

## Set up

1. In "Settings" → "Integrations", enter the service's address and token, then press "Save". "Test connection" checks them
2. For a project that uses an issue tracker, choose it under "This project" → "Issue sync" → "Issue tracker to use". Each project uses one
3. Enter numbers or URLs on the Issue tab of "+ New task". The tab shows the name of the service you chose

The "Integrations" items are the same for every project. The "Issue sync" items are per project.

If the origin of a repository you open for the first time belongs to a GitLab you have saved, the project starts with GitLab selected. If you opened the repository earlier, choose it by hand. If "How to land after review" was set to "Merge directly" at that time, change it to "Create an MR" as well.

## GitLab

Works with gitlab.com and self-hosted GitLab. It does not use `glab`.

| Item | Description |
| --- | --- |
| URL | `https://gitlab.com` by default. For self-hosted GitLab, enter the server's URL. A subpath (`https://example.com/gitlab`) also works |
| Allow an http server | Check this only to use an `http://` address. The token travels unencrypted |
| Personal Access Token | Create it with the `api` scope |

- **MRs**: if origin belongs to the connected GitLab, that repository uses the GitLab API instead of `gh`. The button on a card in review becomes "Create MR". If an MR is already open for the branch, the app uses it instead of creating another
- **Checking MRs**: the app checks whether the MR was merged, conflicts, and the pipeline result. When it finds the merge, it marks the task done. You merge the MR itself on GitLab
- **Status sync**: labels change to match the column. The names are `In progress` / `In review` / `Done`, and you can change them per column under "Issue sync" (one name each; if you write several, the first is used). GitLab creates a label that does not exist. Done closes the Issue, and starting work again reopens it
- **Sub-issues**: uses child tasks (Work Items) where they are available. On versions without them, or when the parent's type cannot have children, it creates an Issue and links it
- **Issues in other projects**: use `group/project#12` or a URL. A number alone means an Issue in the origin project

## Linear

The address is fixed to `api.linear.app`.

| Item | Description |
| --- | --- |
| API key | Create one under Personal API keys in Security & access in Linear's Settings. It needs permission to read and write issues and comments |

- **Status sync**: chooses from the workflow of the Issue's team. Running uses a state of type `started`, review uses a `started` state such as In Review, and done uses a state of type `completed`. If the team has no review state, the Issue stays in its started state
- **Names**: under "Issue sync", you can set the state name to use for each column. A column you set uses only states with that name
- **PR body**: the line uses `Ref`, so merging the PR does not make Linear close the Issue. Status sync does that

## Jira

Works with Jira Cloud and Jira Data Center.

| Item | Description |
| --- | --- |
| Jira type | Jira Cloud or Jira Data Center |
| Jira URL | For example `https://example.atlassian.net`. Include the context path if there is one (`https://jira.example.com/jira`) |
| Allow http connections to Jira | Check this only to use an `http://` address. The token travels unencrypted |
| Email address | Your Atlassian email address. Used on Cloud only |
| Token | An API token on Cloud, a Personal Access Token on Data Center |

- **URLs**: a URL from a site other than the configured one is rejected
- **Status sync**: chooses from the transitions available on that issue right now. Running and done are chosen by status category (In Progress / Done), and review only by a name that contains Review. If nothing matches, or Jira refuses (for example, a required field), the status stays as it is and the reason goes to the log
- **Names**: under "Issue sync", you can set a transition or target status name for each column (comma-separated candidates are allowed)
- **Subtasks**: the project needs a subtask issue type. You cannot create a subtask under a subtask

## Slack

Slack is for posting notifications and starting tasks from Slack. Receiving uses Socket Mode, so you need no public server and no open port. **It works only while the app is open.** While the app is closed, it posts no notifications and starts no tasks.

The steps to create the Slack app also appear under "How to set up" in the Slack entry in "Integrations".

1. Create a Slack app at <https://api.slack.com/apps>
2. Turn on "Socket Mode" and create an App-Level Token with the `connections:write` scope
3. Under "OAuth & Permissions", add `app_mentions:read` and `chat:write` to Bot Token Scopes. Add `commands` too if you use a slash command
4. Turn on "Event Subscriptions" and add `app_mention` to Bot Events. To use a slash command, create it under "Slash Commands" (no Request URL is needed)
5. Install the app to the workspace and invite the bot to the channels you use

| Item | Description |
| --- | --- |
| Bot Token | A token starting with `xoxb-` |
| App-Level Token | A token starting with `xapp-` |
| Channel ID for notifications | In the form `C0123456789`. Nothing is posted if it is empty |
| Notify on completion, failure, and waiting | Each kind can be turned off (all on by default) |
| Slack user IDs that can start tasks | In the form `U0123456789, U0987654321`. **If this is empty, nobody can start a task** |
| Channels and projects | One line each, in the form `C0123456789 /path/to/project`. Tasks can start only from the channels listed here |

- **Kinds of notification**: failures include failed schedules. Waiting covers spec checks, permission checks, questions, waiting for an answer, waiting for review, and conflicts
- **Starting a task**: in a listed channel, mention the bot or use the slash command and write the instructions. Only allowed users are accepted, and anyone else gets a refusal
- **After it starts**: it behaves like any other task. If the instructions are not detailed enough, it stops at the spec check. The project's permission settings apply
- **Updates**: updates on a task requested from Slack go to its thread, whatever the notification settings are
- **Not supported**: you cannot approve or answer questions from Slack; use the app for those. Only the text of the message that mentions the bot becomes instructions. The rest of the thread and attached files are not read. Tasks cannot be started from direct messages

## Tokens and connections

- Tokens are encrypted with a key from the OS secure storage and saved in a separate file from `board.json`. They are never saved in plain text. Linux needs GNOME Keyring, KWallet, or similar; without one, tokens cannot be saved
- Saved tokens are never shown on screen and are not passed to agents
- If you change the URL of a service, tokens you did not re-enter are deleted, so that they are not sent to a different address
- While operating a board from another PC, "Integrations" shows the host's settings. The client can replace a token, but it cannot receive the value of a saved token
- "Delete" removes the service's address and tokens

## Limitations

- There is no OAuth sign-in. You use tokens
- Changes in a service do not come back to the card. Changing a status in Linear or Jira does not move the card
- Comments added to an Issue after the task was created do not reach the agent
- A project can use only one issue tracker

---

[← Back to README](../README.md)
