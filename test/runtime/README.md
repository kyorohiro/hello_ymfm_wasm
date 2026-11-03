# Shared runtime tests

This directory contains the 276 JavaScript test files and the SCSP source type
test previously kept under `web/`. The implementation now lives in
`tetorica_src/runtime/`; see the [repository organization record](../../docs/issues/todo_repository_organization_01.md).

Run from the repository root:

```sh
npm run test:runtime
npm run test:runtime:types
npm test
sh scripts/test_vgm_mock.sh
```

`npm test` includes both the root tests and this directory. `test:analyzer`
also includes the Analyzer's own tests. The runtime runner limits concurrent
test files to two so independent WASM/native fixtures do not all compile at once.

Imports refer directly to the implementation. Tests that read source, load
fixtures or create Worker URLs use `runtimeDirectoryUrl` to retain the source
directory as their URL base. This keeps runtime URL assertions and shared
fixture contents intact. The shared `spc_test_fixture.mjs` and
`native_genesis_extra_creation_fixture.mjs` remain under `tetorica_src/runtime/` because SDK
calibration and other tests also use them.

The migration compared all assertions and module targets with the originals.
Known pre-existing failures are recorded in the organization TODO; they are not
skipped or weakened by these tests.
