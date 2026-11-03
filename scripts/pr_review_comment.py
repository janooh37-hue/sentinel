"""Post a PR Agent review in Greptile's shape: a confidence score out of 5, the
findings with their fixes, and prompts to paste into a coding agent.

PR Agent writes its review as JSON (``pr-agent --json-output review.json review``
with ``config.publish_output=false``). This script turns that JSON into:

* one summary comment on the PR, edited in place on every push: the confidence
  score, a findings table, and a "Fix all with your agent" prompt;
* one inline comment per new finding on the lines it names, each with its own
  fix prompt. A finding already posted on an earlier push is not posted again.

Usage::

    python scripts/pr_review_comment.py review.json          # print the summary
    python scripts/pr_review_comment.py review.json --post   # publish to the PR

``--post`` reads GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, PR_HEAD_REF and
PR_HEAD_SHA from the environment. Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

SUMMARY_MARKER = "<!-- gssg-pr-review -->"
INLINE_MARKER = "<!-- gssg-pr-review:{key} -->"
FENCE = "`````"
PROMPT_TAIL = (
    "For each issue above, determine whether it is valid and should be fixed. "
    "If so, fix it directly."
)
SEVERITY_RE = re.compile(r"^\s*\[?(P[12])\]?\s*[:\-\u2013\u2014]?\s*", re.IGNORECASE)


@dataclass(frozen=True)
class Finding:
    path: str
    start: int
    end: int
    severity: str  # "P1" or "P2"
    title: str
    body: str

    @property
    def key(self) -> str:
        return hashlib.sha1(f"{self.path}\n{self.title}".encode()).hexdigest()[:12]

    @property
    def lines(self) -> str:
        return str(self.start) if self.start == self.end else f"{self.start}-{self.end}"


def _text(value: Any) -> str:
    return str(value).strip() if value is not None else ""


def _int(value: Any, default: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def parse_findings(review: dict[str, Any]) -> list[Finding]:
    findings = []
    for issue in review.get("key_issues_to_review") or []:
        header = _text(issue.get("issue_header"))
        match = SEVERITY_RE.match(header)
        severity = match.group(1).upper() if match else "P2"
        title = header[match.end() :] if match else header
        start = _int(issue.get("start_line"), 1)
        findings.append(
            Finding(
                path=_text(issue.get("relevant_file")),
                start=start,
                end=max(start, _int(issue.get("end_line"), start)),
                severity=severity,
                title=title.strip(" *") or "Issue",
                body=_text(issue.get("issue_content")),
            )
        )
    # P1 first, then file order, so the summary leads with what blocks a merge.
    return sorted(findings, key=lambda f: (f.severity, f.path, f.start))


def confidence(findings: list[Finding], recommendation: str) -> tuple[int, str]:
    """Score how safe the PR is to merge, 1 (unsafe) to 5 (safe), with a verdict.

    Derived from what the review found, so the number always matches the list:
    two or more P1s -> 1, one P1 (or "changes required") -> 2, several P2s -> 3,
    one P2 (or "needs review") -> 4, nothing found -> 5.
    """
    p1 = [f.title for f in findings if f.severity == "P1"]
    p2 = [f.title for f in findings if f.severity == "P2"]
    if len(p1) >= 2:
        return 1, "Fix before merging: " + "; ".join(p1) + "."
    if p1:
        return 2, f"Fix before merging: {p1[0]}."
    if recommendation == "changes_required":
        return 2, "PR Agent recommends changes before merging."
    if len(p2) >= 2:
        return 3, "Review before merging: " + "; ".join(p2) + "."
    if p2:
        return 4, f"Safe to merge after a look at: {p2[0]}."
    if recommendation == "needs_review":
        return 4, "No issues found; PR Agent still suggests a focused human review."
    return 5, "Safe to merge: no issues found."


def _issue_block(finding: Finding) -> str:
    return (
        f"Path: {finding.path}\nLine: {finding.lines}\n"
        f"Comment:\n**{finding.title}**\n{finding.body}"
    )


def fix_all_prompt(findings: list[Finding], repo: str, branch: str) -> str:
    parts = [f'Work in the repository "{repo}" on branch "{branch}".', ""]
    for number, finding in enumerate(findings, 1):
        parts += [f"### Issue {number} ({finding.severity})", _issue_block(finding), ""]
    parts += ["---", "", PROMPT_TAIL]
    return "\n".join(parts)


def fix_one_prompt(finding: Finding, repo: str, branch: str) -> str:
    return "\n".join(
        [
            f'Work in the repository "{repo}" on branch "{branch}".',
            "This is a comment left during a code review.",
            _issue_block(finding),
            "",
            "---",
            "",
            PROMPT_TAIL,
        ]
    )


def _prompt_details(summary: str, prompt: str) -> str:
    return (
        f"<details><summary>{summary}</summary>\n\n{FENCE}markdown\n{prompt}\n{FENCE}\n\n</details>"
    )


def render_summary(review: dict[str, Any], repo: str, branch: str, sha: str) -> str:
    findings = parse_findings(review)
    recommendation = _text(review.get("merge_recommendation"))
    score, verdict = confidence(findings, recommendation)
    lines = [
        SUMMARY_MARKER,
        "## PR Agent review",
        "",
        f"**Confidence score: {score}/5** {'●' * score}{'○' * (5 - score)}",
        "",
        verdict,
    ]
    if findings:
        lines += ["", "| # | Severity | Issue | Where |", "|---|---|---|---|"]
        for number, f in enumerate(findings, 1):
            lines.append(f"| {number} | {f.severity} | **{f.title}** | `{f.path}:{f.lines}` |")
        for number, f in enumerate(findings, 1):
            lines += [
                "",
                f"<details><summary>{number}. {f.title}</summary>\n\n{f.body}\n\n</details>",
            ]
        lines += [
            "",
            _prompt_details("Fix all with your agent", fix_all_prompt(findings, repo, branch)),
        ]
    meta = []
    effort = _text(review.get("estimated_effort_to_review_[1-5]")).split(",")[0]
    if effort:
        meta.append(f"review effort {effort}/5")
    security = _text(review.get("security_concerns"))
    if security:
        meta.append(
            "security: " + ("none found" if security.lower().startswith("no") else "see below")
        )
    if sha:
        meta.append(f"reviewed commit `{sha[:8]}`")
    if meta:
        lines += ["", "<sub>" + " · ".join(meta) + "</sub>"]
    if security and not security.lower().startswith("no"):
        lines += ["", f"**Security:** {security}"]
    return "\n".join(lines) + "\n"


def render_inline(finding: Finding, repo: str, branch: str) -> str:
    return "\n".join(
        [
            INLINE_MARKER.format(key=finding.key),
            f"**{finding.severity} · {finding.title}**",
            "",
            finding.body,
            "",
            _prompt_details("Fix with your agent", fix_one_prompt(finding, repo, branch)),
        ]
    )


class GitHub:
    def __init__(self, token: str, repo: str) -> None:
        self.token = token
        self.base = f"https://api.github.com/repos/{repo}"

    def call(self, method: str, path: str, body: Any = None) -> Any:
        request = urllib.request.Request(
            self.base + path,
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
        )
        with urllib.request.urlopen(request) as response:
            payload = response.read()
        return json.loads(payload) if payload else None

    def every(self, path: str) -> list[Any]:
        items: list[Any] = []
        page = 1
        while True:
            batch = self.call("GET", f"{path}?per_page=100&page={page}")
            items += batch
            if len(batch) < 100:
                return items
            page += 1


def post(review: dict[str, Any], gh: GitHub, number: str, repo: str, branch: str, sha: str) -> None:
    summary = render_summary(review, repo, branch, sha)
    existing = [
        c for c in gh.every(f"/issues/{number}/comments") if SUMMARY_MARKER in (c.get("body") or "")
    ]
    if existing:
        gh.call("PATCH", f"/issues/comments/{existing[0]['id']}", {"body": summary})
    else:
        gh.call("POST", f"/issues/{number}/comments", {"body": summary})

    posted = "\n".join(c.get("body") or "" for c in gh.every(f"/pulls/{number}/comments"))
    for finding in parse_findings(review):
        if INLINE_MARKER.format(key=finding.key) in posted:
            continue
        comment: dict[str, Any] = {
            "body": render_inline(finding, repo, branch),
            "commit_id": sha,
            "path": finding.path,
            "line": finding.end,
            "side": "RIGHT",
        }
        if finding.start < finding.end:
            comment |= {"start_line": finding.start, "start_side": "RIGHT"}
        try:
            gh.call("POST", f"/pulls/{number}/comments", comment)
        except urllib.error.HTTPError as error:
            # Lines outside the diff can't take an inline comment; the summary
            # still lists the finding and its prompt.
            print(
                f"inline comment skipped for {finding.path}:{finding.lines}: {error}",
                file=sys.stderr,
            )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("review_json")
    parser.add_argument("--post", action="store_true", help="publish to the PR")
    args = parser.parse_args()

    with open(args.review_json, encoding="utf-8") as handle:
        review = json.load(handle).get("review") or {}
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    branch = os.environ.get("PR_HEAD_REF", "")
    sha = os.environ.get("PR_HEAD_SHA", "")
    if not args.post:
        sys.stdout.write(render_summary(review, repo, branch, sha))
        return 0
    gh = GitHub(os.environ["GITHUB_TOKEN"], repo)
    post(review, gh, os.environ["PR_NUMBER"], repo, branch, sha)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
