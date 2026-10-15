# Vendored DX7 package

This directory is based on the published `tetorica-msfa-dx7-wasm@0.1.0`
npm package. The pinned WASM/MSFA engine and license files are unchanged.
The JS/declaration surface also includes the working-tree Object preset API
(`setPreset`, `setOperator`, `setOperators`, `getPreset`), which is not in
published 0.1.0 yet. No runtime CDN or npm production dependency is required.

- Tarball: `https://registry.npmjs.org/tetorica-msfa-dx7-wasm/-/tetorica-msfa-dx7-wasm-0.1.0.tgz`
- Verified base tarball integrity: `sha512-feLVHuAgkcqlCiHEuzZMWzSkUBMDoeZOvTcGzMcAqgOhdGAaZbbqJIVBSo88LEnh/THYu6R8f+oOZZuWDm/u9w==`
- Package license: `LICENSE` (Apache-2.0).
- Third-party notices: `THIRD_PARTY_NOTICES.md`.
- Upstream MSFA license and revision: `vendor/msfa/COPYING`, `vendor/msfa/UPSTREAM.md`.

`README.vendor.md` is Playground's provenance note. Maintain the JS surface in
`w/tetorica-msfa-dx7-wasm/src`, then run `node scripts/sync_dx7_runtime.mjs`
from the main repository to refresh the checked-in copies and Monaco types.
Ordinary builds use this vendored copy and do not require that separate checkout.
The Playground integration lives in the adjacent
`playground_dx7*.js` modules. The original package uses a fixed internal
44,100 Hz synthesis rate and supports 44,100/48,000 Hz output.
