# Agent board

A Paseo plugin: one board for the tasks (PRs and issues) of every repository
under a workspace folder and the agents working on them, with optional
`/deliver` and `/intake` integration from
[paseo-dev-team](https://github.com/asquad/paseo-dev-team). See
[OVERVIEW.md](OVERVIEW.md) for what it shows.

## Install

Plugins must be enabled in Paseo (Settings → Plugins).

```sh
npm install
npm run typecheck
paseo plugin install "$PWD"
```

Then set the root folder in Settings → Agent board. After `git pull`, run
`paseo plugin reload agent-board`.

## Layout

| Path | Runtime |
|---|---|
| `index.client.tsx`, `client/` | Paseo app: board, filters, task and agent details, settings, Deliver from scratch |
| `index.server.ts`, `server/` | Daemon: project discovery, run state files, TODO store, `gh` search and lookups, agent launches |
| `shared/` | RPC contracts, settings, the agent model (`model.ts`) and the task model (`work.ts`) |

The deliver run state format is defined in paseo-dev-team,
`skills/deliver/references/run-state.md`.
