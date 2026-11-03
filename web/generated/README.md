# Generated runtime assets

This is the complete canonical output directory for Tetorica's browser runtime.
[runtime-artifacts.json](runtime-artifacts.json) lists 33 pinned SDK builds
(32 loader/WASM pairs and DX7's standalone WASM), Native FX, build metadata,
source/license references and public mirrors.

Run these commands from the repository root:

```sh
npm run check:runtime-artifacts
npm run sync:runtime-artifacts
sh scripts/build_ym2612_wasm.sh
```

Checks never write. Synchronization validates the SDK receipts, output hashes,
PS1 provenance and Native FX ABI before copying. Normal builds write here and
synchronize their public mirrors. Explicit custom output directories remain
isolated. Do not hand-edit generated loaders or receipts.

The SDK files stay flat here. Native FX uses `effects/gain.wasm`. Public assets
remain at `docs/generated/` and the existing DX7/Native FX paths; packagers
select their required subset through the shared inventory.

See the [source guide](../README.md), [build instructions](../../docs/building_ym2612_wasm.md)
and [organization TODO](../../docs/issues/todo_web_organization_01.md).
