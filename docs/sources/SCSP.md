# Saturn SCSP source and rebuilding

The standalone C++17 SCSP/DSP, C API, pristine MAME upstream, revision, hashes and
attribution are included under [scsp-sdk/vendor/mame-scsp/](scsp-sdk/vendor/mame-scsp/README.md).
These are byte-exact inputs from the fixed tetorica-soundchip-native SDK, including
its unpublished local-candidate status where applicable. [SCSP.json](SCSP.json)
records that pin and the distributed input/output hashes. Output hashes identify
the shipped pair; they are not a separate compiler provenance receipt.

From this sources directory, with Emscripten available:

`sh scsp-sdk/scripts/build_scsp_wasm.sh ../generated`

The original SDK layout and recipe are retained; no network, full SDK checkout,
MAME framework, CPU, BIOS, ROM or game recording is required. Each core owns 32
physical slots / 512 KiB RAM and renders stereo PCM at 44,100 Hz. Native hosts
compile scsp_instrument.cpp, scsp.cpp and scspdsp.cpp from the component directory.
CPU/timer/IRQ/SSF execution is not provided. DSP/FM/LFO behavior and hardware
fidelity are not established by the current PCM/transport checks. The original
MAME envelope/DSP approximations remain documented in the component README.
