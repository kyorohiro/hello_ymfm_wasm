# Nuked-OPN2

Vendored unmodified from https://github.com/kyorohiro/Nuked-OPN2 (a fork of
the original https://github.com/nukeykt/Nuked-OPN2), commit
`335747d78cb0abbc3b55b004e62dad9763140115` (version 1.0.9, per the header
comment in `ym3438.h`).

Keeping our own fork pinned to a specific commit gives this repository a
stable, always-available copy of the exact source these files were built
from, independent of upstream.

License: GNU Lesser General Public License v2.1 or later. See `LICENSE`.

This is a separate, more strongly copylefted license than the rest of this
repository (ymfm is BSD 3-Clause). Anything that statically links this WASM
build should keep that in mind before distributing it. See
`scripts/build_nuked_opn2_wasm.sh` for how to rebuild `nuked_opn2_wasm.wasm`
from this source.
