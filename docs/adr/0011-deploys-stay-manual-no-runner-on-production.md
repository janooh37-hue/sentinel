---
status: accepted
---

# Deploys stay manual; no runner on the production server

Merging to `main` now requires green CI (spec #329), so it is tempting to take
the next step and deploy every merge automatically. That needs something that
can act on the production server `GSSGIT`: a GitHub Actions runner installed on
it, or a hosted runner holding a credential that reaches it. The repository is
public. Anyone can open a pull request, and a pull request can change the
workflows it runs. A runner on `GSSGIT`, or a deploy credential in Actions
secrets, would put a stranger's code one workflow mistake away from live HR
records, the Word COM session and the server's `.env` secrets. GitHub itself
recommends self-hosted runners only for private repositories.

## Decision

- Deploys stay manual. A person runs `mng update` on `GSSGIT`, directly or
  through the `deploy` skill. There is no runner of any kind on `GSSGIT`, no
  self-hosted runner elsewhere, and no deploy credential in GitHub.
- A deploy refuses a commit that is not green. `mng update` fetches, then reads
  the target commit's check runs and commit statuses from GitHub's public API
  with no token, before the checkout moves. Green means at least one result and
  every one concluded success, neutral or skipped. Failed, still running,
  missing, or an API that does not answer: not green, and nothing changes. The
  `deploy` skill makes the same check as its first step.
- `mng update -Force` skips the check and prints a warning, so a hotfix is never
  blocked by CI or GitHub being down.

## Considered options

- Self-hosted runner on `GSSGIT` deploying on push to `main`: rejected; it runs
  workflow code on the production server of a public repository.
- Hosted runner deploying over SSH or the tailnet: rejected; it puts a
  production credential in Actions secrets, reachable by any workflow that
  lands on `main`.
- Manual deploy with a green-commit gate and a `-Force` override: taken.

## Consequences

- A merge does not ship until someone runs `mng update`; production can lag
  `main`, and the `deploy` skill shows what will ship.
- A red or still-running `main` commit cannot ship by accident. With CI or
  GitHub down, only `-Force` ships, and it says so on screen.
- The check needs no GitHub credential on the server; the unauthenticated rate
  limit (60 requests an hour) is far above what manual deploys use.
- Undoing this decision means revisiting the public-repository risk above, not
  just installing a runner.
