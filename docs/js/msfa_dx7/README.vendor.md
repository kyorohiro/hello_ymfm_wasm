# Vendored DX7 package

This directory contains the unmodified files from the published
`tetorica-msfa-dx7-wasm@0.1.0` npm package. No runtime CDN or npm production
dependency is required by Playground.

- Tarball: `https://registry.npmjs.org/tetorica-msfa-dx7-wasm/-/tetorica-msfa-dx7-wasm-0.1.0.tgz`
- Verified registry integrity: `sha512-feLVHuAgkcqlCiHEuzZMWzSkUBMDoeZOvTcGzMcAqgOhdGAaZbbqJIVBSo88LEnh/THYu6R8f+oOZZuWDm/u9w==`
- Package license: `LICENSE` (Apache-2.0).
- Third-party notices: `THIRD_PARTY_NOTICES.md`.
- Upstream MSFA license and revision: `vendor/msfa/COPYING`, `vendor/msfa/UPSTREAM.md`.

`README.vendor.md` is Playground's provenance note and is the only additional
file here. The Playground integration lives in the adjacent
`playground_dx7*.js` modules. The original package uses a fixed internal
44,100 Hz synthesis rate and supports 44,100/48,000 Hz output.
