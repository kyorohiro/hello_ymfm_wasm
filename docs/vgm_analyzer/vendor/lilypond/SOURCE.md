# Corresponding source

This package contains a statically linked LilyPond WebAssembly binary and its
run-time data.

The signed `v0.1.0-alpha.1` tag identifies this release. Its complete matching
source is:

<https://github.com/hlolli/lilypond-wasm/releases/download/v0.1.0-alpha.1/lilypond-wasm-v0.1.0-alpha.1-source.tar.zst>

Source archive SHA-256: `ec09aec6382e3db1355d02b3354ae81705d3100fad9fd1cf111ea8d8ed4650f7`

Wasm SHA-256: `e957ee1839f0102d9fd543821019e7ecb5fac71584dcc7a92983dd7525499961`

That archive must contain this repository, every local patch and build file,
the pinned LilyPond and dependency sources, and the linked WASI and LLVM
run-time sources. It must include the instructions needed to rebuild and
relink the Wasm file with changed LGPL libraries.

The release `SHA256SUMS` asset records the source archive and npm tarball
hashes. The npm tarball hash cannot appear inside that same tarball.

Do not publish this npm package until the source asset exists. Keep the source
asset available for as long as this package version remains available.
