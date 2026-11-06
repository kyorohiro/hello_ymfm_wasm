# Tetorica SID source kit

Experimental 6581, zlib chip core with a BSD-3-Clause host.

Original pinned header, marked adaptation, license, Native host and WASM bridge
are included with their original relative paths. See
[component README](third_party/chips-m6581/README.md) and
[patches](third_party/chips-m6581/PATCHES.md). No C64 ROM or game data is included.

With Node.js, Python 3 and Emscripten installed, from this directory:

```sh
python3 scripts/prepare_sid_core.py --check
sh scripts/build_sid_wasm.sh /tmp/tetorica-sid-rebuild
```

The explicit directory build records matching input hashes without modifying
public copies. Browser API source is in tetorica_src/runtime/. This prototype
is separate from the fixed tetorica-soundchip-native SDK and its catalog.
