# Contributing to Worktree Kanban

Thanks for your interest. Bug reports, ideas, and pull requests are all welcome.

## Where to start

| You want to… | Go to |
| --- | --- |
| Ask a question or share an idea | [Discussions](https://github.com/kazuya83/worktree-kanban/discussions) |
| Report a bug | [Issues](https://github.com/kazuya83/worktree-kanban/issues) |
| Report a security vulnerability | [SECURITY.md](SECURITY.md) (please do not open a public issue) |

For a bug report, include your Worktree Kanban version, your OS, the agent CLI you used (and its version), the steps to reproduce, and what you expected to happen.

For a large change, open a Discussion or an Issue first so we can agree on the direction before you spend time on it.

## Set up

You need Node.js 22 or later (24 recommended), git, and at least one agent CLI you have signed in to (Claude Code, Codex CLI, Antigravity CLI, Gemini CLI, or Cursor CLI).

```bash
npm install
npm start
```

`npm install` also sets `core.hooksPath` to `.githooks` in your clone. The `post-merge` hook starts a build (and, if `gh` is signed in with access, a release) after a merge whose message starts with `Merge agent task:`. To turn it off in your fork:

```bash
git config --unset core.hooksPath
```

More on building and how the app works is in [docs/development.md](docs/development.md) (Japanese).

## Make a change

1. Fork the repository and create a branch from `main`.
2. Make your change. Keep it focused on one thing.
3. Add or update tests in `test/` when behavior changes.
4. Run the tests:

   ```bash
   npm test
   ```

5. Open a pull request against `main`, and describe what changed and why.

GitHub Actions runs `npm test` on every pull request. To check the builds for all three platforms on a Mac, run `scripts/build-all.sh`.

## Conventions

- **User-facing text:** the app is translated into English, Japanese, Spanish, French, and Simplified Chinese. When you add or change text in the UI, update every language in `renderer/locales/`. The i18n tests check for missing entries.
- **README:** the five `README*.md` files share the same structure, and `test/readme-i18n.test.js` checks that. Change all of them together.
- **Licensing wording:** Worktree Kanban is released under FSL-1.1-ALv2, which is source-available. Please do not describe it as "open source" in docs or text.

## Releases

Maintainers build and publish releases from a Mac with `scripts/release-local.sh`. GitHub Actions only runs tests. You do not need to bump the version in `package.json`, and changes to docs or tests alone do not produce a release. See [CHANGELOG.md](CHANGELOG.md) for the history.

## License of contributions

By submitting a contribution, you agree that it is licensed under the same [license](LICENSE) as the project (FSL-1.1-ALv2).
