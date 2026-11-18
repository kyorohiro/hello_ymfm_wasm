# SCSP Synth New Cassette menu — 2026-11-18

User requested a New section above Import in the SCSP Synth menu, containing
Cassette. This creates a fresh project; Import → Cassette remains available.

- [x] Inspect existing Synth New Cassette flows and reuse the established
  project/default-file and explicit confirmation behavior where applicable.
- [x] Add New → Cassette… with a fresh default SCSP sound, starter Code and
  existing examples. Never run Code automatically.
- [x] Preserve current files/project on cancellation or failed preparation;
  replace the project only after validation and successful sound application.
- [x] Verify menu ordering, fresh identity/defaults, cancellation/failure and
  persistence with focused tests. Keep audio-pipeline work separate.

No audio/processor changes, implementation of other roadmap items, publication,
commit or push is included in this menu task.

Reused the YM2149 ST confirmation flow: Cancel, Export current & create,
Create without export. Detached preparation uses the SCSP project's original
starter factory and current default examples. Application/editor failures and
cancellation during a pending Apply restore the previous project and identity;
the existing performance may already have stopped at that stage. A failed
local save leaves the new Cassette available for export and reports this.

One fresh sound read before owner retirement supplies the optional backup and
failure rollback, including current Code edits. An unavailable read reports its
fallback to the last cached sound; it adds no background polling.

Focused Files/project tests: 56 passed. Actual muted-browser and exact package
verification are recorded with the combined output-level/menu verification.

See [combined verification](verification_scsp_output_level_new_cassette_20261118.md).
