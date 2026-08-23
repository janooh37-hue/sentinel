# Task Pipeline — Agent-Driven Issue → Build → Review → PR

**Date:** 2026-08-23
**Status:** Approved
**Type:** Tooling (project skill, no app code changes)

## Problem

Work on this repo is currently ad-hoc: a request lands in chat, gets built inline,
and there is no enforced separation between doing the work, judging the work, and
packaging the work for merge. This design defines an agent pipeline that turns any
chat message into categorized GitHub issues and drives each issue through
independent specialist agents until a pull request is open — with a human as the
final gate.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Trigger | Auto-triage **every** message; non-tasks answered directly |
| Categories | BUG / FEATURE / POLISH / QUESTION (direct answer) |
| Mixed input | Split into separate issues |
| Architecture | One orchestrator skill spawning role subagents |
| Roles | Triage → Builder → Reviewer → Gatekeeper (+ Orchestrator) |
| Human gate | PR opened = pipeline stops; only the human merges |
| Rejection loop | Builder⇄Reviewer until approved; tripwire pause at rejection #5 |
| State | GitHub is the DB: labels + issue comments; single-writer pattern |
| Parallelism | Parallel workers via per-issue git worktrees |
| Builder exit gates | pytest + ruff + mypy mandatory; pnpm build/lint if frontend touched |
| Reviewer testing | Scoped spot-check of test files touching changed areas |
| Branches | `<type>/<issue#>-<slug>` off `main`, same repo, PR → `main` |
| Skill location | `.claude/skills/task-pipeline/` committed to repo |
| Models | Per-role model mapping in one `models.json`; all default to current model |

## Pipeline

```
message → triage → issue(s) → [Builder ⇄ Reviewer]* → Gatekeeper → PR opened → HUMAN merges
                        ↑______________|  (rejection = itemized fix list)
```

### Stage behavior

1. **Triage** — categorizes the message. BUG = behavior contradicts intent;
   FEATURE = new capability; POLISH = improves existing behavior without changing
   it; QUESTION = answered directly, nothing created. Mixed messages are split.
   Each issue carries: category label, problem statement, repro steps (bugs), and
   an **explicit acceptance checklist** so review judges concrete criteria.
   New issue labeled `stage:queued`.

2. **Builder** — implements fully: code, tests, docs. Runs full exit gates and
   includes proof (command output) in its handoff. Gate failures before handoff
   are fixed by the builder and do **not** count as reviewer rejections.

3. **Reviewer** — read-only inspection against the issue checklist plus scoped
   test spot-checks (only test files related to changed areas). Harsh and itemized:
   REJECT must list every failing point; APPROVE requires a clean checklist pass.

4. **Gatekeeper** — after approval, verifies integration safety: diff vs `main`,
   conflict dry-run, secret scan, scope check against the issue checklist, CI/deploy
   config inspection. Dirty → bounce back through Reviewer → Builder loop.

5. **Orchestrator** — spawns all roles, owns worktree/branch lifecycle, enforces
   the tripwire, and is the **sole writer** to GitHub.

### Tripwire

Rejections loop indefinitely by design. At rejection #5 (configurable in
`models.json`/config): accumulated complaints posted on the issue, task labeled
`blocked`, user pinged. Only that task pauses; parallel tasks continue. User
arbitrates and the loop resumes on their word.

## State protocol (GitHub-as-DB)

- Labels = current stage: `stage:queued` → `stage:building` → `stage:reviewing`
  → `stage:gatekeeping` → `stage:pr-opened`; plus type labels `bug`/`feature`/
  `polish`; plus `blocked`.
- Issue comments = append-only event log: every handoff, rejection list, gate
  proof, PR link.
- PR body contains `Closes #N` → human merge auto-closes the issue.
- Crash-safe resume: orchestrator restarts, lists open issues by stage label,
  resumes each from its recorded stage.

## Permission matrix (least privilege)

| Role | Allowed | Forbidden |
|---|---|---|
| Triage | Read repo/docs for accurate issues; return structured triage output | Edit files, run builds/tests, git, spawn agents, write to GitHub |
| Builder | Edit code only inside its own worktree/branch; run pytest/ruff/mypy/pnpm gates; commit & push its own branch; read its issue | Touch `main`, other branches/worktrees, `.env`, `deploy/`, CI configs, secrets; merge; open/close/label issues; force-push |
| Reviewer | Read diff/files/issue/gate-proof; run scoped test spot-checks (read-only execution) | Edit/create/delete any file; git mutations; approve without checklist pass |
| Gatekeeper | Diff branch vs `main`; conflict dry-run (`git merge-tree`); secret-scan diff; scope check vs checklist; inspect CI/deploy configs | Fix things itself (bounce-back only); edit; merge; push anywhere |
| Orchestrator | Sole GitHub writer (issues, labels, comments, PRs); worktree/branch lifecycle; spawns roles per `models.json`; enforces tripwire | Edit project source code |

Hard no-fly files for every role: `.env`, credential/key files, `deploy/`,
service installers. Gatekeeper scans every diff for secrets before any PR.

Enforcement note: tool-level restriction depends on harness support per subagent.
Where unavailable, rules are hard constraints inside role prompts and the
orchestrator validates outputs (e.g., rejects handoffs lacking gate proof).
Enforcement depth is verified during build before relying on it.

## Role–model assignment

Each role agent's `model:` frontmatter line in `.opencode/agents/pipeline/<role>.md`
is the switchboard — changing a role's model is a one-line edit to that file.
All four ship pointed at the current model. Verified: opencode loads project
agents from `.opencode/agents/` with native `model` and `permission` fields,
so no external registry file is needed.

## File layout

```
.opencode/agents/pipeline/
├── triage.md             # frontmatter: model + hard tool permissions; body: role prompt
├── builder.md
├── reviewer.md
└── gatekeeper.md
.claude/skills/task-pipeline/
└── SKILL.md              # orchestrator: flow, loop rules, state protocol
```

## Known costs / risks

1. Full pytest suite per submission × parallel workers × rejection loops is
   token/CPU-hungry. Accepted for this test copy.
2. Agent branches accumulate on the production repo's remote until merged/deleted.
3. Infinite-loop risk mitigated only by the tripwire; if the harness cannot pause,
   worst case is unbounded retries on one task.

## Verification plan

- Confirm subagent model override honored (or fallback wired).
- Dry-run one toy issue end-to-end through all stages on a scratch branch.
- Confirm gates fire: missing gate proof rejected at handoff; reviewer itemization
  format enforced; tripwire fires at configured threshold; worktrees cleaned up
  after PR opens.
