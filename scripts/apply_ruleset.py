"""Apply the `main` ruleset and the merge settings to the GitHub repository.

`.github/rulesets/main.json` is the ruleset on the default branch: no deletion,
no force-push, changes only through a PR whose conversations are resolved, which
is up to date with `main` and whose required checks are green. The repository
admin role can bypass it, through a PR only. This script creates the ruleset, or
updates the one with the same name, so running it again is safe. It also turns
on "Update branch", auto-merge and delete-branch-on-merge, and allows merge
commits only.

Needs the GitHub CLI (`gh`), logged in as a repository admin.

    python scripts/apply_ruleset.py                      apply to janooh37-hue/sentinel
    python scripts/apply_ruleset.py --repo owner/name    apply to another repository

Roll back by deleting the ruleset by the id this script prints:

    gh api -X DELETE repos/janooh37-hue/sentinel/rulesets/<id>
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
RULESET = ROOT / ".github" / "rulesets" / "main.json"
DEFAULT_REPO = "janooh37-hue/sentinel"
SETTINGS = {
    "allow_update_branch": True,
    "allow_auto_merge": True,
    "delete_branch_on_merge": True,
    "allow_merge_commit": True,
    "allow_squash_merge": False,
    "allow_rebase_merge": False,
}


def gh_api(*args: str, body: dict[str, Any] | None = None) -> Any:
    result = subprocess.run(
        ["gh", "api", *args, *(["--input", "-"] if body is not None else [])],
        input=json.dumps(body) if body is not None else None,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"gh api {' '.join(args)} failed:\n{result.stderr}{result.stdout}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def apply_ruleset(repo: str, ruleset: dict[str, Any]) -> int:
    """Create the ruleset, or replace the one with the same name; return its id."""
    existing = gh_api("--paginate", "--slurp", f"repos/{repo}/rulesets?includes_parents=false")
    same_name = [r for page in existing for r in page if r["name"] == ruleset["name"]]
    if same_name:
        rid = same_name[0]["id"]
        gh_api("-X", "PUT", f"repos/{repo}/rulesets/{rid}", body=ruleset)
        print(f"updated ruleset {ruleset['name']!r} (id {rid})")
    else:
        rid = gh_api("-X", "POST", f"repos/{repo}/rulesets", body=ruleset)["id"]
        print(f"created ruleset {ruleset['name']!r} (id {rid})")
    return int(rid)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--repo", default=DEFAULT_REPO, help="owner/name")
    args = parser.parse_args()

    ruleset = json.loads(RULESET.read_text(encoding="utf-8"))
    rid = apply_ruleset(args.repo, ruleset)
    gh_api("-X", "PATCH", f"repos/{args.repo}", body=SETTINGS)
    print(f"repository settings applied: {json.dumps(SETTINGS)}")
    print(f"roll back: gh api -X DELETE repos/{args.repo}/rulesets/{rid}")


if __name__ == "__main__":
    main()
