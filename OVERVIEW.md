Agent board manages the work of a whole multi-repository workspace (a folder that holds several related repositories) from one screen. The unit on the board is a task, a GitHub PR or issue, with the Paseo agents working on it as its details. Repositories are a filter, not separate boards.

## Active work

The first tab lists the PRs and issues you marked TODO and the ones agents are working on, one row per task. An issue and the PR opened for it are one task. Each row shows a coloured status (needs you, question, running, waiting for an external requirement, ready, stopped, TODO, closed), the title as Paseo shows the workspace, when the task was sent and when it last changed. Sort by any column and filter by repository, type, status, GitHub labels, author and text; filters are remembered. Closed and merged tasks are hidden unless you select them.

The details show links, labels and the author, the coordinator and every subagent with its status, the latest report, a prompt box (Steer while an agent runs), and buttons to open, archive or start work. Agents that do not belong to a PR or issue are grouped under "Без задачи" (no task).

## PRs and issues

The second tab lists the open PRs and issues of all repositories that pass the filter, told apart by icon and filterable by type, labels and author (through `gh search`). Every row has TODO and DELIVER buttons; a task already in work shows its status instead. A pasted URL works too. Extra configurable buttons (any profile, any prompt template) sit behind the ⋯ menu and in the details.

## Optional paseo-dev-team integration

With [paseo-dev-team](https://github.com/asquad/paseo-dev-team) installed:

- DELIVER starts `/deliver <url>` from the workspace root with the `team-coordinator` profile.
- DELIVER FROM SCRATCH takes a free-form description and starts `/scratch`: it extends matching issues or creates new ones in the right repositories. The board then lists them for review; confirming one starts `/deliver` on it.
- The board reads the run state files those skills write to `~/.paseo-dev-team/runs` and shows each run's round, stage, review score, blocker, question and created issues.

Without paseo-dev-team, switch the integration off; TODO, filters, agents and custom buttons keep working.

## Settings and data

Root folder (empty shows every project), board name, subagent list, action buttons, the paseo-dev-team switch, the run state folder, and the profile and prompt for Deliver from scratch. TODO entries are stored locally in `~/.paseo-agent-board/todo.json`. The plugin runs `git remote get-url` in each project and `gh search`, `gh api` and `gh pr view` for PRs and issues; it sends nothing elsewhere.
