"""Build the Analyzer-only SID mixer WASMs from the two SID song source kits."""
import argparse
from pathlib import Path
from shutil import copytree
from subprocess import run
from tempfile import TemporaryDirectory


def edit(path, before, after):
    source = path.read_text()
    if source.count(before) != 1:
        raise ValueError(f"Unexpected source in {path}: {before}")
    path.write_text(source.replace(before, after))


def build(out, rsid, machine, work):
    # Each AudioWorklet owns one machine and its own WASM instance. Apply the
    # mask after oscillator/sync/envelope processing, before dry/filter routing.
    out.mkdir(parents=True, exist_ok=True)
    copytree(rsid / "third_party/chips-m6581", work / "chips")
    header = work / "chips/m6581.h"
    edit(header, "int env_out = (int) v->env_cur_level;",
         "int env_out = (analyzer_mute_mask & (1u << i)) ? 0 : (int) v->env_cur_level;")
    chip = work / "chip.cpp"
    chip.write_text('#include <emscripten/emscripten.h>\nstatic unsigned analyzer_mute_mask;\n'
                    'extern "C" EMSCRIPTEN_KEEPALIVE void analyzer_set_mute(unsigned mask) { analyzer_mute_mask = mask; }\n'
                    + (rsid / "tetorica_src/wasm/sid_rsid_chip.cpp").read_text()
                    .replace('../../third_party/chips-m6581/m6581.h', 'chips/m6581.h'))
    src = rsid / "tetorica_src/wasm"
    obj = work / "machine.o"
    run(["emcc", src / "sid_rsid_machine.c", "-std=c11", "-O2", "-DNDEBUG", "-ffp-contract=off", "-c", "-o", obj], check=True)
    run(["em++", src / "sid_rsid_wasm.cpp", chip, obj, "-std=c++17", "-O2", "-DNDEBUG", "-ffp-contract=off",
         "-sSTANDALONE_WASM=1", "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=4194304",
         "-sMAXIMUM_MEMORY=67108864", "-sSTACK_SIZE=65536", "--no-entry", "-o", out / "6581.wasm"], check=True)
    rust = work / "sidera"
    copytree(machine / "third_party/sidera/adapted/src", rust)
    edit(rust / "sid.rs", "self.filter.clock(o0, o1, o2, 0);",
         """let mask = ANALYZER_MUTE.load(core::sync::atomic::Ordering::Relaxed);
        self.filter.clock(if mask & 1 == 0 { o0 } else { 0 },
                          if mask & 2 == 0 { o1 } else { 0 },
                          if mask & 4 == 0 { o2 } else { 0 }, 0);""")
    with (rust / "sid.rs").open("a") as f:
        f.write('\nstatic ANALYZER_MUTE: core::sync::atomic::AtomicU32 = core::sync::atomic::AtomicU32::new(0);\n'
                'pub fn analyzer_set_mute(mask: u32) {\n'
                '    ANALYZER_MUTE.store(mask, core::sync::atomic::Ordering::Relaxed);\n}\n')
    with (rust / "lib.rs").open("a") as f:
        f.write("\npub use sid::analyzer_set_mute;\n")
    wrapper = work / "endpoint.rs"
    endpoint = machine / "tetorica_src/wasm/sid8580-machine/endpoint.rs"
    wrapper.write_text(f'include!("{endpoint.as_posix()}");\n'
                       '#[no_mangle] pub extern "C" fn analyzer_set_mute(mask:u32) { sidera::analyzer_set_mute(mask); }\n')
    flags = ["rustc", "--edition=2021", "-C", "opt-level=3", "-C", "panic=abort", "-C", "codegen-units=1",
             "--target", "wasm32-unknown-unknown", "--remap-path-prefix", f"{work}=tetorica",
             "--remap-path-prefix", f"{machine}=tetorica"]
    lib = work / "libsidera.rlib"
    run([*flags, "--crate-name", "sidera", "--crate-type", "rlib", rust / "lib.rs", "-o", lib], check=True)
    run([*flags, "--crate-name", "sid8580_endpoint", "--crate-type", "cdylib",
         wrapper, "--extern", f"sidera={lib}",
         "-o", out / "8580.wasm"], check=True)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=root / "docs/generated/sid-analyzer")
    parser.add_argument("--rsid", type=Path, default=root)
    parser.add_argument("--machine", type=Path, default=root)
    args = parser.parse_args()
    with TemporaryDirectory() as tmp:
        build(args.out.resolve(), args.rsid.resolve(), args.machine.resolve(), Path(tmp))
