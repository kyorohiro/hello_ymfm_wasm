# Put the tested SCSP cycle2 prototype in Examples - 2026-11-18

Base `d0372196`; worktree was clean. User asked to make the research Code
available in Examples rather than requiring a separate research file/paste.

- [x] Move the byte-identical prototype into `examples/scsp/` and regenerate
  the canonical Playground example bundle, keeping default index code intact.
- [x] Update scoped tests, browser loading path and user documentation. Preserve
  old measurement JSON as historical evidence of the earlier research run.
- [x] Verify cold SCSP mode offers the example in Files without executing it;
  select and run the bundled text in Main/Worker with permanently muted output.
- [x] Check mode filtering, saved-project behavior, generated bundle consistency
  and source/package receipt implications. Add a compact verification record.

No new Synth cyclic-graph support, runtime/core/WASM/preset change, native
research rerun, package publication, version bump, commit/push/tag or Tauri work.
Evidence: `build/scsp-cycle2-examples-20261118/`.

Completed: 36 example/restoration tests, 5 exact data-only source guard tests,
32 browser checks, both Mixer generators, runtime artifact and package module
graph checks pass. Existing projects retain edited examples and Run selection.
See [verification](verification_scsp_cycle2_examples_20261118.md).
