VERDICT: CONFIRMED

No blocking issues remain in the preview area. The plan now resolves the last blocker (inmate reporters gaining scans and an `original=true` paper after the `papersOf` cutover):
- **Required flag, all callers.** 3e (lines 284-292) makes `opts: { inmateReporter }` required on `papersOf`. Every caller must therefore set it: the desk and full-screen viewer (S3, line 535), the pane and its full-preview overlay (S4, line 666, with the local filter at `RecordPane.tsx:107-126` deleted), and the existing test calls.
- **Inmate-reporter rule.** For inmate reporters, `papersOf` drops every scan, drops the generated original when a signed copy exists, and never emits `original=true`. This matches today's `RecordPane.tsx:112-116`. The plan cites the server facts that make the client-side rule necessary (`books.py:1179-1194`, `:1788-1803`).
- **Tests.** The tests (lines 318-320) cover three cases:
  - inmate approved, signed copy plus a scan → `[signed]`;
  - inmate unsigned with a scan → `[generated]`, with no `original=true` in `url` or `downloadUrl`;
  - staff → `[signed, generated, scan]`, with `original=true` on the generated paper.
- **Shared contract.** §4 (line 761) records the same rule.

REVIEW READY
