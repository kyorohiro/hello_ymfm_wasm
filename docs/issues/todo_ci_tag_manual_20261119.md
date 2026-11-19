# CI: tag pushes and manual runs

Current policy is the later [lightweight release plan](todo_ci_lightweight_release_20261119.md):
only release ZIPs, VGM and SBI run on tags; detailed workflows are manual-only.
The checklist below records the preceding trigger-only change.

Routine verification runs locally. GitHub test/build workflows run on tag pushes
or explicit workflow_dispatch, rather than branch pushes or pull requests.

- [x] Update all 20 repository test/build workflow triggers; keep job definitions,
  assertions, permissions and existing concurrency settings unchanged.
- [x] Retain manual execution for each workflow, including VGM and SBI checks.
- [x] Validate workflow YAML and trigger coverage without starting remote runs.
- [x] Document latest-code execution versus retrying an existing failed run.

GitHub Pages deployment is managed separately and is outside this change.
Already-running Actions are not cancelled or restarted by this change.

All tags match `push.tags: ['**']`; branch pushes and pull requests no longer
start these workflows. A tag push starts every test/build workflow, regardless
of which app changed. This is validation/artifact packaging, not publication.

After pushing a fix, run the selected workflow on the latest remote main:

```sh
gh workflow run scsp-synth.yml --ref main
gh workflow run huc6280-synth.yml --ref main
```

To retry failed jobs using the original run's commit (not a newly pushed fix):

```sh
gh run rerun RUN_ID --failed
```

Inspect runs without starting additional work:

```sh
gh run list --limit 10
gh run view RUN_ID --log-failed
```

Validation: Ruby YAML parsed all 20 workflows; each has only tag push and manual
triggers. Everything from `permissions:` onward matches HEAD byte-for-byte.
`git diff --check` passes. No remote execution, commit, push or tag was performed.

## Subsequent lightweight release policy

See [lightweight release CI](todo_ci_lightweight_release_20261119.md).
The all-workflows-on-tags policy above is superseded: only itch ZIP release,
VGM and SBI retain tag triggers; detailed workflows remain manual-only.
