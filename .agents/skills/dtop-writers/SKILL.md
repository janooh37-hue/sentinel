---
name: "dtop-writers"
description: "Run writer agents and heavy test runs on the desktop (dtop) instead of the laptop: one worktree and branch per agent, briefed by file, results reviewed before merging. Use whenever work is split across agents or needs the full test suite."
---

# /dtop-writers

The desktop (`dtop`, Omarchy Linux, 32 GB, 20 cores) runs the agents and the tests. The laptop (`GSSGLT`, 8 GB) runs out of memory with more than one agent, so it keeps to orchestration, the dev channel and Word/document checks. Parallelise freely on dtop: as many writers as the task splits into.

Before a heavy run check `ssh dtop free -g`. If a stray heavy process (ComfyUI, old `omp ps` services) leaves under about 8 GB available, ask the user before stopping it (`omp ps stop <name> --dir <project>` for omp-supervised ones). Leave other worktrees and agents on dtop alone.

## Branches

Every writer gets its own worktree and branch on dtop. Which base depends on the job (see the `dev-cycle` skill for the rule behind this):

- **One writer, one change:** the writer works on the feature branch itself, cut from `origin/main`.
- **Several writers on one change:** cut the feature branch from `origin/main` first, then one sub-branch per writer from the feature branch, with no shared files. Merge finished sub-branches into the feature branch in its worktree on dtop. Only the feature branch is previewed and sent to `main`.

Never base a writer on `dev`, and never merge a writer's branch into `dev` by hand: `dev-channel.ps1 preview <feature-branch>` on the laptop does that.

## Start a writer

1. Worktree: `ssh dtop 'cd ~/Projects/sentinel && git fetch origin && git worktree add -b <branch> .worktrees/<name> <base>'` where `<base>` is `origin/main` or the feature branch.
2. Brief: write it to `<worktree>/.tmp/brief-<name>.md` on dtop. Include the goal, owned files, whether edits are allowed, the check to run (`~/.venvs/sentinel/bin/python -m pytest <narrowest>`), "commit on this branch", and "write your report to `<worktree>/.tmp/handoff-<name>.md` and reply with the path only". Tell the agent to use subagents.
3. Tab: `herdr --machine dtop tab create --workspace <id> --cwd <worktree> --label <name> --no-focus`.
4. Agent: `herdr --machine dtop agent start <name> --kind omp --pane <returned-pane> -- --model <model> --goal "Read .tmp/brief-<name>.md in this worktree and complete it exactly, including the report step."` Cheap model to explore, strong model to write and review.
5. Goal mode starts working at once, so `agent start` may report the name lost; fix it with `herdr --machine dtop agent rename <pane> <name>`, then `herdr --machine dtop agent wait`.

## Collect

- Reports are claims. `ssh dtop cat <worktree>/.tmp/handoff-<name>.md`, then on the laptop `git fetch desk` and read `git diff origin/main...desk/<branch>` before merging or previewing anything.
- Small fixes go back to the same agent. Bigger follow-ups go to a fresh agent briefed with the handoff file, so no agent works with a full context.
- When a branch is merged or abandoned: `herdr --machine dtop tab close <tab>`, then remove its worktree and branch on dtop.

## Tests

- Writers run the narrowest pytest for what they changed.
- Before the PR, run the full suite once on dtop, in the feature worktree, with `-n 6`: `ssh dtop 'cd ~/Projects/sentinel/.worktrees/<name> && ~/.venvs/sentinel/bin/python -m pytest -n 6'`.
- Requirements changed: `uv pip install -p ~/.venvs/sentinel/bin/python -r requirements.txt pytest-xdist` there first.
