#!/usr/bin/env python3
"""Audit release archives, then build the extracted SDK without another checkout.

Uses only Python's standard library, CMake and the installed C++ toolchain.
No dependency download or network package manager is run by this test.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import stat
import struct
import subprocess
import tempfile
import wave
import zipfile


class AuditError(RuntimeError):
    pass


REQUIRED_CHIPS = frozenset("ym2612 ym2203 ym2610 ym2610b rf5c164 ym2608 gameboy segapsg ym2151 pwm nes dx7 snes spc huc6280 okim6258 ym3526 ym3812 y8950 ymf262 ym2413 ay8910 wonderswan pokey".split())
REQUIRED_ARTIFACTS = frozenset("ay8910 gameboy_apu huc6280 k051649 nesapu nuked_opn2 okim6258 pokey pwm32x rf5c164 segapcm segapsg spc y8950 ym2151 ym2203 ym2413 ym2608 ym2610b ym2612 ym3438 ym3526 ym3812 ymf262 ymf276 ymf278b ymf288 dx7 wonderswan".split())
REQUIRED_JAVASCRIPT_REFERENCES = frozenset(("msm5205", "okim6295"))
REQUIRED_APPLICATION_AUDIO = frozenset(("cdda", "msm5205"))
REQUIRED_NATIVE_FIXTURES = frozenset(("tetorica_ym2612_fixture", "tetorica_ym2151_fixture",
                                      "tetorica_segapsg_fixture", "tetorica_ym2413_fixture", "tetorica_ay8910_fixture",
                                      "tetorica_ym2203_fixture", "tetorica_ym2608_fixture", "tetorica_ym2610_fixture",
                                      "tetorica_okim6258_fixture", "tetorica_rf5c164_fixture",
                                      "tetorica_opl_fixture", "tetorica_extra_opl_fixture", "tetorica_y8950_memory_fixture",
                                      "tetorica_gameboy_fixture", "tetorica_huc6280_fixture", "tetorica_nes_fixture",
                                      "tetorica_pwm_fixture", "tetorica_extra_pwm_fixture", "tetorica_dx7_fixture", "tetorica_snes_fixture", "tetorica_spc_fixture", "tetorica_nuked_ym2612_fixture", "tetorica_nuked_colink_fixture", "tetorica_wonderswan_fixture", "tetorica_pokey_fixture"))
REQUIRED_NATIVE_EXAMPLES = {"tetorica_genesis_wav": "Genesis", "tetorica_master_system_wav": "Master System",
                            "tetorica_msx_wav": "MSX", "tetorica_pc98_ym2203_wav": "PC-98 YM2203",
                            "tetorica_pc98_ym2608_wav": "PC-98 YM2608", "tetorica_neogeo_wav": "NeoGeo",
                            "tetorica_x68000_wav": "X68000", "tetorica_megacd_wav": "Mega-CD",
                            "tetorica_dos_opl_wav": "DOS PC OPL", "tetorica_msx_audio_wav": "MSX-AUDIO",
                            "tetorica_gameboy_wav": "Game Boy", "tetorica_pcengine_wav": "PC Engine",
                            "tetorica_nes_fds_wav": "NES with FDS", "tetorica_32x_wav": "32X",
                            "tetorica_dx7_wav": "DX7", "tetorica_snes_wav": "SNES", "tetorica_spc_wav": "SPC", "tetorica_nuked_genesis_wav": "Nuked Genesis", "tetorica_wonderswan_wav": "WonderSwan", "tetorica_pokey_wav": "Dual POKEY"}
REQUIRED_NATIVE_FIXTURES |= frozenset(("tetorica_cdda_fixture", "tetorica_msm5205_fixture", "tetorica_pce_cd_fixture"))
REQUIRED_NATIVE_EXAMPLES["tetorica_pcengine_cd_wav"] = "PC Engine CD-ROM2"
REQUIRED_NATIVE_FIXTURES |= frozenset(("tetorica_ps1_spu_fixture",))
REQUIRED_NATIVE_EXAMPLES["tetorica_ps1_spu_wav"] = "PlayStation SPU"
REQUIRED_NATIVE_EXECUTABLES = REQUIRED_NATIVE_FIXTURES | frozenset(REQUIRED_NATIVE_EXAMPLES)
REQUIRED_UPSTREAM_REFERENCES = frozenset((
    "libvgm-msm5205-upstream", "libvgm-okim6295-upstream", "mame-okim6295-upstream",
))


def require(value, message):
    if not value:
        raise AuditError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def relative_path(value):
    require(isinstance(value, str) and value and "\\" not in value and "\0" not in value,
            f"Invalid release path: {value!r}")
    path = PurePosixPath(value)
    require(not path.is_absolute() and not re.match(r"^[A-Za-z]:", value)
            and all(part not in (".", "..", "") for part in value.split("/")),
            f"Release path escapes its root: {value}")
    return path


def within(path, root):
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def read_json(path):
    require(path.is_file(), f"Missing {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def unpack(archive, destination):
    """Validate every member before writing any archive content."""
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        require(members, "Empty release archive")
        roots, names, folded_names = set(), set(), set()
        for member in members:
            name = member.filename.rstrip("/")
            path = relative_path(name)
            require(name not in names, f"Duplicate ZIP member: {name}")
            require(name.casefold() not in folded_names, f"Case-colliding ZIP member: {name}")
            names.add(name)
            folded_names.add(name.casefold())
            roots.add(path.parts[0])
            mode = member.external_attr >> 16
            require(not stat.S_ISLNK(mode), f"Symlink in release ZIP: {name}")
            require(not mode or stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR),
                    f"Non-regular ZIP member: {name}")
            require(not member.flag_bits & 1, f"Encrypted ZIP member: {name}")
        require(len(roots) == 1, "Release ZIP must contain one SDK root directory")
        root = destination / next(iter(roots))
        source.extractall(destination)
    require(root.is_dir(), "SDK release root is not a directory")
    return root


def audit_manifest(root, expected_kind):
    manifest = read_json(root / "RELEASE-MANIFEST.json")
    require(manifest.get("schemaVersion") == 1 and manifest.get("kind") == expected_kind,
            f"Unexpected release manifest schema/kind: {expected_kind}")
    require(manifest.get("name") == "tetorica-soundchip-native" and manifest.get("version"),
            "Missing SDK release identity")
    files = manifest.get("files")
    require(isinstance(files, dict) and files, "Manifest has no file inventory")
    actual = set()
    for path in root.rglob("*"):
        require(not path.is_symlink(), f"Symlink after extraction: {path}")
        if path.is_file() and path != root / "RELEASE-MANIFEST.json":
            actual.add(path.relative_to(root).as_posix())
    require(actual == set(files), f"Manifest inventory mismatch: missing={sorted(set(files)-actual)}, unlisted={sorted(actual-set(files))}")
    for name, metadata in files.items():
        path = root / relative_path(name)
        require(isinstance(metadata, dict) and isinstance(metadata.get("size"), int),
                f"Invalid manifest record: {name}")
        require(path.stat().st_size == metadata["size"], f"Size mismatch: {name}")
        require(digest(path) == metadata.get("sha256"), f"SHA-256 mismatch: {name}")
    return manifest


def check_references(root, owner, key, values):
    require(isinstance(values, list) and values, f"{owner}: no {key}")
    for name in values:
        path = root / relative_path(name)
        require(path.is_file() and within(path, root), f"{owner}: missing/outside {key} reference {name}")
        if key == "licenseFiles":
            require(path.stat().st_size > 0, f"{owner}: empty license file {name}")


def audit_javascript_references(root, catalog, inventory):
    references = []
    for owner, document in (("chip catalog", catalog), ("source inventory", inventory)):
        records = document.get("javascriptReferences")
        require(isinstance(records, list), f"Missing {owner} JavaScript references")
        ids = [record.get("id") for record in records]
        require(len(ids) == len(set(ids)) and set(ids) == REQUIRED_JAVASCRIPT_REFERENCES,
                f"{owner} JavaScript reference inventory changed: {ids}")
        references.append({record["id"]: record for record in records})
    require(references[0] == references[1], "JavaScript references differ between the two catalogs")
    source_hashes = {item["path"] for component in inventory["components"] for item in component.get("files", [])}
    for identifier, record in references[0].items():
        require(record.get("format") == "javascript-es-module", f"{identifier}: invalid JavaScript reference format")
        require(record.get("entryPoint") == f"reference/javascript/{identifier}audioengine.js",
                f"{identifier}: invalid JavaScript entry point")
        for key in ("sourceFiles", "licenseFiles"):
            check_references(root, identifier, key, record.get(key))
        require(record["entryPoint"] in record["sourceFiles"], f"{identifier}: entry point missing from sourceFiles")
        require(set(record["sourceFiles"]) <= source_hashes,
                f"{identifier}: JavaScript source missing from hash provenance")
        for backend in ("native", "wasm"):
            expected = {"status": "separate-application-module", "module": "msm5205"} if identifier == "msm5205" and inventory.get("applicationAudio") else {"status": "not-ported"}
            require(record.get(backend) == expected,
                    f"{identifier}: JavaScript reference must remain {backend} not-ported or explicitly reference the separate application module")
    package = read_json(root / "reference/javascript/package.json")
    require(package.get("type") == "module", "JavaScript references require a local ES module package")


def audit_upstream_references(root, catalog, inventory):
    references = []
    for owner, document in (("chip catalog", catalog), ("source inventory", inventory)):
        records = document.get("upstreamReferences")
        require(isinstance(records, list), f"Missing {owner} upstream references")
        ids = [record.get("id") for record in records]
        require(len(ids) == len(set(ids)) and set(ids) == REQUIRED_UPSTREAM_REFERENCES,
                f"{owner} upstream reference inventory changed: {ids}")
        references.append({record["id"]: record for record in records})
    require(references[0] == references[1], "Upstream references differ between the two catalogs")
    components = {component["id"]: component for component in inventory["components"]}
    for identifier, record in references[0].items():
        require(record.get("role") == "upstream-source-reference" and record.get("sdkIntegration") == {
            "native": "not-integrated", "wasm": "not-integrated",
        }, f"{identifier}: upstream source reference must not claim an SDK runtime port")
        require(isinstance(record.get("commit"), str) and re.fullmatch(r"[0-9a-f]{40}", record["commit"]),
                f"{identifier}: full immutable upstream commit required")
        require(isinstance(record.get("repository"), str) and record["repository"].startswith("https://"),
                f"{identifier}: upstream repository URL required")
        manifest_path = root / relative_path(record.get("snapshotManifest"))
        manifest = read_json(manifest_path)
        for key, value in manifest.items():
            if key != "files":
                require(value == record.get(key), f"{identifier}: upstream manifest {key} differs from catalog")
        component = components.get(identifier)
        require(component is not None, f"{identifier}: upstream source lacks provenance component")
        source_hashes = {item["path"]: item for item in component.get("files", [])}
        manifest_files = manifest.get("files")
        require(isinstance(manifest_files, list) and manifest_files, f"{identifier}: upstream manifest has no sources")
        sources = set()
        for item in manifest_files:
            source = manifest_path.parent / relative_path(item.get("path"))
            require(source.is_file() and within(source, root), f"{identifier}: missing upstream snapshot source")
            name = source.relative_to(root).as_posix()
            require(name not in sources, f"{identifier}: duplicate upstream snapshot source {name}")
            sources.add(name)
            relative_path(item.get("upstreamPath"))
            require(digest(source) == item.get("sha256"), f"{identifier}: upstream snapshot hash mismatch: {name}")
            provenance = source_hashes.get(name, {})
            require(provenance.get("sha256") == item.get("sha256"),
                    f"{identifier}: upstream source missing from hash provenance: {name}")
            require(provenance.get("originPath") == item.get("upstreamPath"),
                    f"{identifier}: upstream source origin differs from manifest: {name}")
        manifest_name = manifest_path.relative_to(root).as_posix()
        require(manifest_name in source_hashes, f"{identifier}: upstream manifest missing from hash provenance")
        actual = {path.relative_to(root).as_posix() for path in manifest_path.parent.rglob("*") if path.is_file()}
        require(actual == sources | {manifest_name}, f"{identifier}: upstream snapshot files differ from manifest")
        for key in ("sourceFiles", "licenseFiles"):
            check_references(root, identifier, key, record.get(key))
            require(set(record[key]) == set(component.get(key, [])),
                    f"{identifier}: upstream {key} differs from provenance component")
        require(set(record["sourceFiles"]) <= sources, f"{identifier}: upstream source references differ from snapshot")
        require(set(record["licenseFiles"]) <= source_hashes.keys(),
                f"{identifier}: upstream license missing from hash provenance")


def audit_application_audio(root, catalog, inventory, native):
    records = inventory.get("applicationAudio", [])
    natives = native.get("applicationAudio", [])
    entries = catalog.get("applicationAudio", [])
    if not (records or natives or entries):
        return  # Older source archives have no application-audio extension.
    for label, items in (("source", records), ("native", natives), ("catalog", entries)):
        ids = [entry.get("id") for entry in items]
        require(len(ids) == len(set(ids)) and set(ids) == REQUIRED_APPLICATION_AUDIO,
                f"Application audio {label} inventory changed")
    source_hashes = {item["path"] for component in inventory["components"] for item in component.get("files", [])}
    for record in records:
        identifier = record["id"]
        require(record.get("format") == "standalone-audio-wasm" and record.get("role") == "application-audio" and record.get("chipIds") == [],
                f"{identifier}: application audio must remain a separate standalone PCM API")
        for key in ("sourceFiles", "licenseFiles"):
            check_references(root, identifier, key, record.get(key))
            require(set(record[key]) <= source_hashes, f"{identifier}: application audio lacks {key} hash provenance")
        check_references(root, identifier, "buildScript", [record.get("buildScript")])
        check_references(root, identifier, "buildFiles", record.get("buildFiles"))
        device = next(entry for entry in natives if entry["id"] == identifier)
        require(device.get("target") == f"tetorica_native_{identifier}" and device.get("cmakeAlias") == f"tetorica::{identifier}",
                f"{identifier}: application audio Native target mismatch")
        require(device.get("publicHeader") == f"native/include/tetorica/{identifier}.h",
                f"{identifier}: application audio public header mismatch")
        check_references(root, identifier, "publicHeader", [device.get("publicHeader")])
        for key in ("sourceFiles", "licenseFiles", "buildFiles"):
            check_references(root, identifier, key, device.get(key))
        entry = next(entry for entry in entries if entry["id"] == identifier)
        require(entry.get("native") == device and entry.get("wasm", {}).get("artifacts") == [{key: record[key] for key in ("id", "format", "buildScript")}],
                f"{identifier}: application audio catalogs differ")


def audit_instruments(root, catalog, inventory, native):
    sources, devices, entries = (document.get("instruments", []) for document in (inventory, native, catalog))
    if not (sources or devices or entries):
        # Keep audit compatibility with earlier source releases and fixtures.
        version = read_json(root / "sdk.json").get("version", "0.0.0")
        require(tuple(int(part) for part in version.split("-")[0].split(".")) < (0, 1, 6), "PS1 instrument inventory is missing")
        return
    expected = {item.get("id") for item in sources}
    require("ps1_spu" in expected and expected <= {"ps1_spu", "scsp"}, "Standalone instrument inventory changed")
    for label, records in (("source", sources), ("native", devices), ("catalog", entries)):
        ids = [item.get("id") for item in records]
        require(len(ids) == len(set(ids)) and set(ids) == expected, f"Standalone instrument {label} inventory changed")
    hashes = {item["path"] for component in inventory["components"] for item in component.get("files", [])}
    for record in sources:
        identifier = record["id"]
        device = next(item for item in devices if item["id"] == identifier)
        entry = next(item for item in entries if item["id"] == identifier)
        require(record.get("role") == "instrument" and record.get("chipIds") == [] and record.get("format") == "emscripten-es-module", f"{identifier} must remain a separate instrument API")
        for key in ("sourceFiles", "licenseFiles"):
            check_references(root, identifier, key, record.get(key))
            require(set(record[key]) <= hashes, f"{identifier} {key} lacks imported hash provenance")
        for key in ("sourceFiles", "licenseFiles", "buildFiles"):
            check_references(root, identifier, key, device.get(key))
        check_references(root, identifier, "buildScript", [record.get("buildScript")])
        check_references(root, identifier, "buildFiles", record.get("buildFiles"))
        require(device.get("target") == f"tetorica_native_{identifier}" and device.get("cmakeAlias") == f"tetorica::{identifier}" and device.get("publicHeader") == f"native/include/tetorica/{identifier}.h", f"{identifier} Native target/header mismatch")
        check_references(root, identifier, "publicHeader", [device.get("publicHeader")])
        require(entry.get("native") == device and entry.get("wasm", {}).get("artifacts") == [{key: record[key] for key in ("id", "format", "buildScript")}], f"{identifier} instrument catalogs differ")


def audit_catalog(root):
    catalog = read_json(root / "catalog/chips.json")
    require(catalog.get("schemaVersion") == 1, "Unsupported chip catalog schema")
    chips = catalog.get("chips")
    require(isinstance(chips, list) and chips, "Chip catalog is empty")
    ids = [chip.get("id") for chip in chips]
    require(all(isinstance(chip, str) and chip for chip in ids) and len(ids) == len(set(ids)),
            "Missing or duplicate chip catalog ID")
    require(set(ids) == REQUIRED_CHIPS, f"Public chip catalog changed: missing={sorted(REQUIRED_CHIPS-set(ids))}, extra={sorted(set(ids)-REQUIRED_CHIPS)}")
    for chip in chips:
        for key in ("sourceFiles", "licenseFiles"):
            check_references(root, chip["id"], key, chip.get(key))
    inventory = read_json(root / "catalog/source_inventory.json")
    require(inventory.get("schemaVersion") == 1, "Unsupported source inventory schema")
    for section in ("components", "artifacts"):
        records = inventory.get(section)
        require(isinstance(records, list) and records, f"Missing source inventory {section}")
        record_ids = [record.get("id") for record in records]
        require(len(record_ids) == len(set(record_ids)), f"Duplicate source inventory {section} ID")
        if section == "artifacts":
            require(set(record_ids) == REQUIRED_ARTIFACTS, f"WASM source artifact inventory changed: missing={sorted(REQUIRED_ARTIFACTS-set(record_ids))}, extra={sorted(set(record_ids)-REQUIRED_ARTIFACTS)}")
        for record in records:
            for key in ("sourceFiles", "licenseFiles"):
                check_references(root, record["id"], key, record.get(key))
            for item in record.get("files", []):
                path = root / relative_path(item["path"])
                require(path.is_file(), f"Missing imported source: {item['path']}")
                require(digest(path) == item.get("sha256"), f"Imported source hash mismatch: {item['path']}")
            # Imported reference binaries describe their original provenance;
            # source archives intentionally need not contain dist/ binaries.
            for item in record.get("importedFiles", []):
                relative_path(item["path"])
                require(re.fullmatch(r"[a-f0-9]{64}", item.get("sha256", "")),
                        f"Invalid imported reference digest: {item['path']}")
            if section == "artifacts":
                check_references(root, record["id"], "buildScript", [record.get("buildScript")])
                require(isinstance(record.get("chipIds"), list) and record["chipIds"],
                        f"{record['id']}: absent chipIds")
    covered = {chip for artifact in inventory["artifacts"] for chip in artifact["chipIds"]}
    require(set(ids) <= covered, f"WASM inventory lost public chips: {sorted(set(ids)-covered)}")
    audit_javascript_references(root, catalog, inventory)
    audit_upstream_references(root, catalog, inventory)
    native = read_json(root / "catalog/native_inventory.json")
    require(native.get("schemaVersion") == 1 and {chip["id"] for chip in native.get("chips", [])} == REQUIRED_CHIPS,
            "Native reference inventory lost a public chip")
    for chip in native["chips"]:
        check_references(root, chip["id"], "sourceFiles", chip.get("sourceFiles"))
        require(chip.get("status") in ("source-only", "verified"), f"Unknown Native status: {chip['id']}")
    audit_application_audio(root, catalog, inventory, native)
    audit_instruments(root, catalog, inventory, native)
    provenance = read_json(root / "native/reference/SOURCES.json")
    require(provenance.get("schemaVersion") == 1 and provenance.get("entries"), "Missing Native source provenance")
    for item in provenance["entries"]:
        path = root / relative_path(item["file"])
        require(path.is_file() and digest(path) == item.get("sha256"), f"Native source provenance hash mismatch: {item['file']}")
    native_files = {path.relative_to(root).as_posix() for path in (root / "native/reference").rglob("*")
                    if path.is_file() and path.suffix in (".c", ".cc", ".cpp", ".h", ".hpp", ".inc", ".ipp")}
    require(native_files <= {item["file"] for item in provenance["entries"]}, "Native reference source disappeared from provenance inventory")
    return catalog, inventory


def audit_local_sources(root):
    source_suffixes = {".h", ".hh", ".hpp", ".inc", ".ipp", ".inl", ".c", ".cc", ".cpp", ".cxx"}
    network_cmake = re.compile(r"\b(?:FetchContent_(?:Declare|Populate|MakeAvailable)|ExternalProject_Add)\s*\(|\bfile\s*\(\s*DOWNLOAD", re.I)
    network_shell = re.compile(r"\b(?:curl|wget)\s|\bgit\s+clone\b|\b(?:npm|pip3?|uv)\s+(?:install|sync)\b")
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        name = path.relative_to(root).as_posix()
        if path.suffix.lower() in source_suffixes:
            text = path.read_text(encoding="utf-8", errors="replace")
            for match in re.finditer(r'^\s*#\s*include\s*"([^"\n]+)"', text, re.M):
                include = match.group(1)
                require(not include.startswith(("/", "\\")) and not re.match(r"^[A-Za-z]:", include),
                        f"Absolute source include in {name}: {include}")
                if ".." in PurePosixPath(include.replace("\\", "/")).parts:
                    require(within(path.parent / include.replace("\\", "/"), root), f"Outside source include in {name}: {include}")
        if path.name == "CMakeLists.txt" or path.suffix == ".cmake":
            text = "\n".join(line.split("#", 1)[0] for line in path.read_text(encoding="utf-8").splitlines())
            require(not network_cmake.search(text), f"Network/fetched CMake dependency in {name}")
            require(not re.search(r"(?:/Users/|/home/|[A-Za-z]:[\\/])", text), f"Host absolute path in {name}")
        if name.startswith("scripts/") and path.suffix in (".sh", ".py", ".cmake"):
            text = "\n".join(line.split("#", 1)[0] for line in path.read_text(encoding="utf-8").splitlines())
            require(not network_shell.search(text), f"Network/package download in {name}")


def audit_wasm(root, manifest, source_root, source_archive, inventory):
    source_release = manifest.get("sourceRelease")
    require(isinstance(source_release, dict), "WASM release has no companion source archive")
    embedded_source = root / relative_path(source_release.get("path"))
    require(embedded_source.is_file(), "WASM release companion source archive is absent")
    require(embedded_source.stat().st_size == source_release.get("size")
            and digest(embedded_source) == source_release.get("sha256") == digest(source_archive),
            "WASM release companion source archive differs from the audited source ZIP")
    selected = manifest.get("artifacts")
    require(isinstance(selected, list) and selected and len(selected) == len(set(selected))
            and set(selected) <= REQUIRED_ARTIFACTS | REQUIRED_APPLICATION_AUDIO | frozenset(("ps1_spu",)) | {item['id'] for item in inventory.get('instruments', [])}, "Invalid released WASM artifact list")
    info = read_json(root / "wasm/build-info.json")
    require(info.get("schemaVersion") == 1 and {record["id"] for record in info.get("artifacts", [])} == set(selected),
            "WASM build provenance differs from the released artifacts")
    expected_outputs = set()
    for record in info["artifacts"]:
        recipe = next(item for item in [*inventory["artifacts"], *inventory.get("applicationAudio", []), *inventory.get("instruments", [])] if item["id"] == record["id"])
        expected_sources = set(recipe["sourceFiles"] + recipe.get("buildFiles", [recipe["buildScript"]]))
        require({item["path"] for item in record["sourceFiles"]} == expected_sources,
                f"{record['id']}: build provenance omitted a source/build input")
        for item in record["sourceFiles"]:
            path = source_root / relative_path(item["path"])
            require(path.is_file() and path.stat().st_size == item.get("size") and digest(path) == item.get("sha256"),
                    f"{record['id']}: build input differs from companion source: {item['path']}")
        fingerprint = hashlib.sha256(json.dumps(record["sourceFiles"], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        require(fingerprint == record.get("sourceFingerprint"), f"{record['id']}: source fingerprint mismatch")
        names = {"msfa.wasm"} if recipe["format"] == "standalone-wasm" else {record["id"] + "_wasm.js", record["id"] + "_wasm.wasm"}
        require({item["path"] for item in record["outputs"]} == names, f"{record['id']}: missing WASM output")
        for item in record["outputs"]:
            path = root / "wasm" / relative_path(item["path"])
            require(path.is_file() and path.stat().st_size == item.get("size") and digest(path) == item.get("sha256"),
                    f"{record['id']}: WASM output provenance mismatch: {item['path']}")
        require(record.get("compiler", {}).get("version"), f"{record['id']}: missing compiler provenance")
        expected_outputs.update(names)
    actual_outputs = {path.name for path in (root / "wasm").iterdir() if path.suffix in (".js", ".wasm")}
    require(actual_outputs == expected_outputs, "WASM ZIP contains undeclared or missing executable artifacts")


def command(args, cwd, environment):
    arguments = list(map(str, args))
    display = subprocess.list2cmdline(arguments) if os.name == "nt" else shlex.join(arguments)
    print("+ " + display, flush=True)
    subprocess.run(arguments, cwd=cwd, env=environment, check=True)


def windows_command_arguments(text):
    """Split the MS C runtime quoting emitted by CMake/subprocess.list2cmdline.

    shlex's non-POSIX mode splits /I"directory with spaces" incorrectly and
    retains quotes around paths. This parser also preserves Windows backslashes.
    """
    result, index = [], 0
    while index < len(text):
        while index < len(text) and text[index] in " \t":
            index += 1
        if index == len(text):
            break
        value, quoted = [], False
        while index < len(text):
            if text[index] in " \t" and not quoted:
                break
            slashes = 0
            while index < len(text) and text[index] == "\\":
                slashes += 1
                index += 1
            if index < len(text) and text[index] == '"':
                value.extend("\\" * (slashes // 2))
                if slashes % 2:
                    value.append('"')
                elif quoted and index + 1 < len(text) and text[index + 1] == '"':
                    value.append('"')
                    index += 1
                else:
                    quoted = not quoted
                index += 1
            else:
                value.extend("\\" * slashes)
                if index < len(text):
                    if text[index] in " \t" and not quoted:
                        break
                    value.append(text[index])
                    index += 1
        result.append("".join(value))
    return result


def build_path(value, directory):
    path = Path(value)
    return path if path.is_absolute() else directory / path


def audit_compile_commands(root, build, entries, *, windows=None):
    windows = os.name == "nt" if windows is None else windows
    for entry in entries:
        directory = build_path(entry["directory"], build)
        source = build_path(entry["file"], directory)
        require(within(source, root) or within(source, build),
                f"Native compilation borrows an outside source: {source}")
        arguments = entry.get("arguments")
        if arguments is None:
            arguments = windows_command_arguments(entry["command"]) if windows else shlex.split(entry["command"])
        require(isinstance(arguments, list) and all(isinstance(value, str) for value in arguments),
                "Invalid native compiler argument inventory")
        index = 0
        prefixes = ("-isystem", "-iquote", "/external:I", "-I", "/I")
        while index < len(arguments):
            argument, value = arguments[index], None
            for prefix in prefixes:
                if argument == prefix:
                    index += 1
                    require(index < len(arguments), f"Native compiler option has no include path: {argument}")
                    value = arguments[index]
                    break
                if argument.startswith(prefix) and len(argument) > len(prefix):
                    value = argument[len(prefix):]
                    break
            if value is not None:
                include = build_path(value.strip('"'), directory)
                require(within(include, root) or within(include, build),
                        f"Native build borrows an outside include directory: {include}")
            index += 1


def audit_native_file_api(root, build, configuration="Release"):
    required = set(REQUIRED_NATIVE_EXECUTABLES)
    catalog_path = root / "catalog/chips.json"
    if catalog_path.is_file() and any(item.get("id") == "scsp" for item in read_json(catalog_path).get("instruments", [])):
        required.add("tetorica_scsp_fixture")
    reply = build / ".cmake/api/v1/reply"
    indices = sorted(reply.glob("index-*.json"))
    require(indices, "Native CMake build has no File API source inventory")
    index = read_json(indices[-1])
    model = read_json(reply / index["reply"]["codemodel-v2"]["jsonFile"])
    require(Path(model["paths"]["source"]).resolve() == root.resolve(),
            "Native CMake model uses a different source tree")
    require(Path(model["paths"]["build"]).resolve() == build.resolve(),
            "Native CMake model uses a different build tree")
    configurations = [entry for entry in model["configurations"] if entry.get("name") == configuration]
    require(len(configurations) == 1, f"Native CMake build has no unique {configuration} configuration")
    targets = configurations[0]["targets"]
    require(targets, "Native CMake build has no targets")
    fixtures = {}
    for target in targets:
        detail = read_json(reply / target["jsonFile"])
        for source in detail.get("sources", []):
            path = build_path(source["path"], build if source.get("isGenerated") else root)
            require(within(path, root) or within(path, build), f"Native target borrows an outside source: {path}")
        for group in detail.get("compileGroups", []):
            for include in group.get("includes", []):
                path = build_path(include["path"], root)
                require(within(path, root) or within(path, build), f"Native target borrows an outside include directory: {path}")
        name = detail.get("name")
        if name in required:
            require(name not in fixtures, f"Duplicate Native executable target: {name}")
            require(detail.get("type") == "EXECUTABLE", f"Native target is not executable: {name}")
            artifacts = []
            for artifact in detail.get("artifacts", []):
                path = build_path(artifact["path"], build)
                require(within(path, build), f"Native executable escapes the build tree: {path}")
                if path.name == detail.get("nameOnDisk"):
                    artifacts.append(path)
            require(len(artifacts) == 1, f"Native CMake build has no unique executable artifact: {name}")
            fixtures[name] = artifacts[0]
    require(set(fixtures) == required,
            f"Native CMake build is missing required executable targets: {sorted(required-set(fixtures))}")
    require(len({path.resolve() for path in fixtures.values()}) == len(fixtures),
            "Native targets share an executable artifact")
    return fixtures


def audit_example_wav(path, label):
    require(path.is_file(), f"{label} example did not write its WAV: {path}")
    frames, peaks = 0, [0, 0]
    rate = 44100 if label == "PlayStation SPU" else 48000
    try:
        with wave.open(str(path), "rb") as audio:
            require(audio.getnchannels() == 2 and audio.getsampwidth() == 2
                    and audio.getframerate() == rate and audio.getcomptype() == "NONE",
                    f"{label} example must produce uncompressed PCM16 stereo at {rate} Hz")
            expected = audio.getnframes()
            require(expected >= rate, f"{label} example WAV must contain at least one second")
            while data := audio.readframes(4096):
                require(len(data) % 4 == 0, f"{label} example WAV has a truncated stereo payload")
                for left, right in struct.iter_unpack("<hh", data):
                    peaks[0] = max(peaks[0], abs(left))
                    peaks[1] = max(peaks[1], abs(right))
                frames += len(data) // 4
            require(frames == expected, f"{label} example WAV payload is truncated")
    except (wave.Error, EOFError) as error:
        raise AuditError(f"Invalid {label} example WAV: {error}") from error
    require(all(peak > 0 for peak in peaks), f"{label} example WAV must have nonzero PCM in both channels")
    require(max(peaks) < 32767, f"{label} example WAV reaches clipped PCM16 full scale")
    return {"sampleRate": rate, "channels": 2, "bitsPerSample": 16,
            "frames": frames, "channelPeaks": [peak / 32768 for peak in peaks]}


def audit_genesis_wav(path):
    return audit_example_wav(path, "Genesis")


def prepare_native_build(root, build, environment):
    root, build = root.resolve(), build.resolve()
    configuration = "Release"
    query = build / ".cmake/api/v1/query"
    query.mkdir(parents=True)
    (query / "codemodel-v2").touch()
    command(["cmake", "-S", root, "-B", build, f"-DCMAKE_BUILD_TYPE={configuration}",
             "-DBUILD_TESTING=ON", "-DTETORICA_NATIVE_BUILD_TESTS=ON", "-DTETORICA_NATIVE_BUILD_EXAMPLES=ON",
             "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON", "-DFETCHCONTENT_FULLY_DISCONNECTED=ON",
             "-DCMAKE_FIND_USE_PACKAGE_REGISTRY=OFF", "-DCMAKE_FIND_USE_SYSTEM_PACKAGE_REGISTRY=OFF"], root, environment)
    fixtures = audit_native_file_api(root, build, configuration)
    entries = read_json(build / "compile_commands.json") if (build / "compile_commands.json").is_file() else []
    audit_compile_commands(root, build, entries)
    return fixtures


def build_native(root, build, environment):
    root, build = root.resolve(), build.resolve()
    configuration = "Release"
    fixtures = prepare_native_build(root, build, environment)
    command(["cmake", "--build", build, "--config", configuration, "--parallel", "2"], root, environment)
    for name, fixture in fixtures.items():
        require(fixture.is_file(), f"Native executable was not built ({name}): {fixture}")
    command(["ctest", "--test-dir", build, "-C", configuration, "--output-on-failure", "--no-tests=error"], root, environment)
    for target, label in REQUIRED_NATIVE_EXAMPLES.items():
        wav = build / f"{label.lower()} example output.wav"
        command([fixtures[target], wav], build, environment)
        print(f"{label} WAV: " + json.dumps(audit_example_wav(wav, label), sort_keys=True), flush=True)
    return fixtures


def build_pokey_fixture(root, build, environment):
    """Build only the POKEY fixture from an audited extracted source tree."""
    root, build = root.resolve(), build.resolve()
    fixtures = prepare_native_build(root, build, environment)
    fixture = fixtures["tetorica_pokey_fixture"]
    command(["cmake", "--build", build, "--config", "Release", "--target", "tetorica_pokey_fixture", "--parallel", "2"], root, environment)
    require(fixture.is_file(), f"POKEY parity fixture was not built: {fixture}")
    command([fixture, "--self-test"], root, environment)
    return fixtures


def build_ps1_fixture(root, build, environment):
    """Build only the instrument fixture from the audited extracted snapshot."""
    root, build = root.resolve(), build.resolve()
    fixtures = prepare_native_build(root, build, environment)
    fixture = fixtures["tetorica_ps1_spu_fixture"]
    command(["cmake", "--build", build, "--config", "Release", "--target", "tetorica_ps1_spu_fixture", "--parallel", "2"], root, environment)
    require(fixture.is_file(), f"PS1 parity fixture was not built: {fixture}")
    command([fixture, "--self-test"], root, environment)
    return fixtures


def check_pokey_parity(root, fixtures, wasm, environment):
    fixture = fixtures["tetorica_pokey_fixture"]
    require(fixture.is_file(), f"POKEY parity fixture was not built: {fixture}")
    command(["node", root / "tests/check_pokey_core.mjs", "--fixture", fixture, "--wasm-dir", wasm], root, environment)


def build_scsp_fixture(root, build, environment):
    """Resolve and compile SCSP from the extracted, audited source closure."""
    root, build = root.resolve(), build.resolve()
    fixtures = prepare_native_build(root, build, environment)
    require("tetorica_scsp_fixture" in fixtures, "SCSP Native fixture is missing from the source catalog/build")
    fixture = fixtures["tetorica_scsp_fixture"]
    command(["cmake", "--build", build, "--config", "Release", "--target", "tetorica_scsp_fixture", "--parallel", "2"], root, environment)
    require(fixture.is_file(), f"SCSP parity fixture was not built: {fixture}")
    command([fixture, "--self-test"], root, environment)
    return fixtures


def check_scsp_parity(root, fixture, wasm, environment):
    require(fixture.is_file(), f"SCSP parity fixture was not built: {fixture}")
    command(["node", root / "tests/scsp_wasm_smoke.mjs", "--wasm-dir", wasm,
             "--native-fixture", fixture], root, environment)


def check_application_audio(root, wasm, selected, environment, parity=False):
    for identifier in sorted(set(selected) & REQUIRED_APPLICATION_AUDIO):
        command(["node", root / "tests/application_audio_wasm_smoke.mjs", wasm, identifier], root, environment)
        if parity:
            command(["node", root / "tests/check_application_audio_core.mjs", "--wasm-dir", wasm,
                     "--artifact", identifier], root, environment)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-zip", type=Path, required=True)
    parser.add_argument("--wasm-zip", type=Path)
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--audit-only", action="store_true")
    parser.add_argument("--wasm-smoke", action="store_true", help="Run supported released Node ABI smokes (YM2612/WonderSwan/POKEY/CD-DA/MSM5205) even with --audit-only")
    parser.add_argument("--javascript-smoke", action="store_true", help="Run the two JavaScript reference smokes with Node.js 22+, even with --audit-only")
    parser.add_argument("--build-wasm", metavar="ARTIFACT", help="Also rebuild one WASM artifact using installed Emscripten")
    parser.add_argument("--pokey-native-parity", action="store_true", help="Even with --audit-only, build the extracted POKEY fixture and compare supplied/rebuilt POKEY WASM")
    parser.add_argument("--ps1-native-parity", action="store_true", help="Build the extracted SPU fixture and compare supplied/rebuilt PS1 instrument WASM")
    parser.add_argument("--scsp-native-parity", action="store_true", help="Build the extracted SCSP fixture and compare supplied/rebuilt SCSP WASM")
    parser.add_argument("--application-audio-parity", action="store_true", help="Compare selected CD-DA/MSM5205 WASM with C/C++ cores from the extracted source; requires a local C/C++ compiler")
    args = parser.parse_args()
    work = (args.work_dir or Path(tempfile.mkdtemp(prefix="tetorica SDK standalone "))).resolve()
    work.mkdir(parents=True, exist_ok=True)
    require(not any(work.iterdir()), f"Standalone work directory must be empty: {work}")
    root = unpack(args.source_zip.resolve(), work / "source")
    manifest = audit_manifest(root, "source")
    require(root.name == f"{manifest['name']}-{manifest['version']}", "Source ZIP root differs from its release identity")
    catalog, inventory = audit_catalog(root)
    audit_local_sources(root)
    if args.wasm_zip:
        wasm = unpack(args.wasm_zip.resolve(), work / "wasm")
        wasm_manifest = audit_manifest(wasm, "wasm")
        require(wasm_manifest["version"] == manifest["version"], "Source and WASM versions differ")
        audit_wasm(wasm, wasm_manifest, root, args.source_zip.resolve(), inventory)
    if getattr(args, "ps1_native_parity", False):
        require((args.wasm_zip and "ps1_spu" in wasm_manifest["artifacts"]) or args.build_wasm in ("ps1_spu", "all"),
                "--ps1-native-parity needs supplied or rebuilt PS1 SPU WASM")
    if getattr(args, "scsp_native_parity", False):
        require(any(item['id'] == 'scsp' for item in inventory.get('instruments', [])), "SCSP instrument is missing from source catalog")
        require((args.wasm_zip and "scsp" in wasm_manifest["artifacts"]) or args.build_wasm in ("scsp", "all"),
                "--scsp-native-parity needs supplied or rebuilt SCSP WASM")
    if args.application_audio_parity:
        supplied_audio = args.wasm_zip and set(wasm_manifest["artifacts"]) & REQUIRED_APPLICATION_AUDIO
        require(supplied_audio or args.build_wasm in REQUIRED_APPLICATION_AUDIO | {"all"},
                "--application-audio-parity needs supplied or rebuilt CD-DA/MSM5205 WASM")
    environment = os.environ.copy()
    for key in ("CPATH", "CPLUS_INCLUDE_PATH", "C_INCLUDE_PATH", "LIBRARY_PATH", "LD_LIBRARY_PATH",
                "DYLD_LIBRARY_PATH", "CMAKE_PREFIX_PATH", "PKG_CONFIG_PATH", "NODE_PATH"):
        environment.pop(key, None)
    fixtures = None
    if not args.audit_only:
        fixtures = build_native(root, work / "native-build", environment)
    elif args.pokey_native_parity:
        require((args.wasm_zip and "pokey" in wasm_manifest["artifacts"]) or args.build_wasm in ("pokey", "all"),
                "--pokey-native-parity needs supplied or rebuilt POKEY WASM")
        fixtures = build_pokey_fixture(root, work / "native-build", environment)
    if getattr(args, "ps1_native_parity", False) and fixtures is None:
        fixtures = build_ps1_fixture(root, work / "native-build", environment)
    scsp_fixture = fixtures.get("tetorica_scsp_fixture") if fixtures else None
    has_scsp = any(item['id'] == 'scsp' for item in inventory.get('instruments', []))
    will_smoke = not args.audit_only or args.wasm_smoke or args.pokey_native_parity or args.application_audio_parity or getattr(args, "ps1_native_parity", False) or getattr(args, "scsp_native_parity", False)
    needs_scsp = has_scsp and (getattr(args, "scsp_native_parity", False) or args.build_wasm in ('scsp', 'all') or
        (args.wasm_zip and 'scsp' in wasm_manifest['artifacts'] and will_smoke))
    if needs_scsp and (scsp_fixture is None or not scsp_fixture.is_file()):
        scsp_fixture = build_scsp_fixture(root, work / "scsp-native-build", environment)["tetorica_scsp_fixture"]
    if not args.audit_only or args.javascript_smoke:
        require(shutil.which("node"), "JavaScript reference smoke requires Node.js 22+")
        command(["node", root / "tests/javascript_reference_smoke.mjs", root / "reference/javascript"], root, environment)
    if args.wasm_zip and (not args.audit_only or args.wasm_smoke or args.pokey_native_parity or args.application_audio_parity or getattr(args, "ps1_native_parity", False) or getattr(args, "scsp_native_parity", False)):
        require(shutil.which("node"), "WASM ABI smoke requires Node.js")
        selected = set(wasm_manifest["artifacts"])
        if "ym2612" in selected or not selected.intersection({"wonderswan", "pokey", "cdda", "msm5205", "ps1_spu", "scsp"}):
            command(["node", root / "tests/wasm_smoke.mjs", wasm / "wasm"], root, environment)
        if "ps1_spu" in selected:
            command(["node", root / "tests/ps1_spu_wasm_smoke.mjs", wasm / "wasm", *([fixtures["tetorica_ps1_spu_fixture"]] if fixtures else [])], root, environment)
        if "scsp" in selected:
            check_scsp_parity(root, scsp_fixture, wasm / "wasm", environment)
        if "wonderswan" in selected:
            command(["node", root / "tests/wonderswan_wasm_smoke.mjs", wasm / "wasm"], root, environment)
        if "pokey" in selected:
            command(["node", root / "tests/pokey_wasm_smoke.mjs", wasm / "wasm"], root, environment)
            if fixtures:
                check_pokey_parity(root, fixtures, wasm / "wasm", environment)
        check_application_audio(root, wasm / "wasm", selected, environment, args.application_audio_parity)
    if args.build_wasm:
        require(shutil.which("emcc" if args.build_wasm in REQUIRED_APPLICATION_AUDIO else "em++"), "--build-wasm requires installed Emscripten")
        command(["sh", root / "scripts/build-wasm.sh", args.build_wasm, work / "rebuilt-wasm"], root, environment)
        require(any((work / "rebuilt-wasm").rglob("*.wasm")), "WASM build produced no WASM artifact")
        if args.build_wasm in ("ym2612", "all"):
            command(["node", root / "tests/wasm_smoke.mjs", work / "rebuilt-wasm"], root, environment)
        if args.build_wasm in ("ps1_spu", "all"):
            command(["node", root / "tests/ps1_spu_wasm_smoke.mjs", work / "rebuilt-wasm", *([fixtures["tetorica_ps1_spu_fixture"]] if fixtures else [])], root, environment)
        if has_scsp and args.build_wasm in ("scsp", "all"):
            check_scsp_parity(root, scsp_fixture, work / "rebuilt-wasm", environment)
        if args.build_wasm in ("wonderswan", "all"):
            command(["node", root / "tests/wonderswan_wasm_smoke.mjs", work / "rebuilt-wasm"], root, environment)
        if args.build_wasm in ("pokey", "all"):
            command(["node", root / "tests/pokey_wasm_smoke.mjs", work / "rebuilt-wasm"], root, environment)
            if fixtures:
                check_pokey_parity(root, fixtures, work / "rebuilt-wasm", environment)
        check_application_audio(root, work / "rebuilt-wasm", REQUIRED_APPLICATION_AUDIO if args.build_wasm == "all" else [args.build_wasm], environment, args.application_audio_parity)
    print(f"PASS: {len(catalog['chips'])} chips, {len(inventory['artifacts'])} chip WASM recipes, {len(catalog.get('applicationAudio', []))} application-audio modules, {len(catalog.get('instruments', []))} instruments and {len(catalog['javascriptReferences'])} JavaScript references; standalone release at {root}")


if __name__ == "__main__":
    try:
        main()
    except (AuditError, subprocess.CalledProcessError, ValueError, OSError, zipfile.BadZipFile) as error:
        raise SystemExit(f"FAIL: {error}")
