# Playwright regression suite

Standalone scripts, no test runner needed. Each file is self-contained:

```
node tests/test-doc.js
```

Run everything:

```
for f in tests/test-*.js; do node "$f" || echo "FAILED: $f"; done
```

Each script prints `PASS`/`FAIL` per scenario and exits non-zero if anything failed.

## Why these exist

The app has no live SQL Server available outside production, so each script serves
`public/index.html` from a tiny local static server, launches headless Chromium, and
drives the real client-side functions (`uploadDoc`, `saveContract`, `switchTab`, ...)
against an in-page mock backend. Most mock backends `require()` the actual server-side
validation/workflow modules (`lib/createValidation.js`, `lib/workflowEngine.js`,
`lib/recordActions.js`) directly — they have no SQL dependency — so business rules are
exercised as real production code, not reimplemented guesses. A few of the simpler
suites (auth/login, admin/permissions, approval hub, minutes, meeting/car, VPP,
doc/submission/task) instead mock `window.fetch` directly with a minimal per-route
stub, since those flows don't hinge on server-side validation logic.

## Shared helpers — naming is inconsistent, by design of how this suite was built

These files were written independently (by different sessions/agents covering
different module groups) without a shared convention, so the same *kind* of helper
ended up under different names. They are not interchangeable — each test file
`require()`s a specific one:

- `testHarness.js` — used by `test-uniform.js`, `test-it-support.js`, `test-periodic-report.js`
- `_harness.js` + `_mock-backend.js` — used by `test-internal-*.js`, `test-reports.js`
- `_harness-contract.js` + `_mockBackend.js` + `_seed.js` — used by `test-contract.js`, `test-payment.js`, `test-office-budget.js`

(`_harness-contract.js` was renamed from a second, unrelated `_harness.js` that
originally collided with the one above when both batches were merged into this
directory — same filename, different content, first-come-first-served.)

The remaining files (`test-doc.js`, `test-submission.js`, `test-task.js`,
`test-auth-login.js`, `test-admin-users-permgroups.js`, `test-approval-hub.js`,
`test-minutes.js`, `test-meeting-car.js`, `test-vpp.js`) are fully self-contained,
no shared helper.

If you add a new test file, prefer reusing whichever existing helper already covers
a similar module rather than inventing a fourth naming scheme.

## `.tmp-assets/`

Small dummy files (`test-contract.js`) generated fresh on every run for file-upload
scenarios. Gitignored — not meant to be committed.
