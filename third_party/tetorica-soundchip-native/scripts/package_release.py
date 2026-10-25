#!/usr/bin/env python3
"""Create deterministic, self-contained release ZIPs from local inputs only."""
import argparse
from pathlib import Path
import stat
import zipfile
from sdk_common import ROOT, check_collection, file_record, json_bytes, local_path, metadata, read_json, sha256, verify_record

SOURCE_DIRS = (".github", "catalog", "docs", "native", "reference", "scripts", "tests", "vendor", "wasm")
SOURCE_FILES = (".gitattributes", ".gitignore", "CMakeLists.txt", "sdk.json", "README.md", "LICENSE", "LICENSE.tools", "LICENSES.md", "CHANGELOG.md")
SKIP_DIRS = {".git", ".svn", ".hg", "node_modules", "target", "build", "dist", "releases", "__pycache__"}


def source_payload():
    payload = {}
    def add(path):
        relative = path.relative_to(ROOT).as_posix()
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts) or path.name.endswith((".pyc", ".pyo")) or path.name == ".DS_Store":
            return
        if path.is_symlink():
            raise ValueError(f"Release inputs cannot be symlinks: {relative}")
        if path.is_dir():
            for child in sorted(path.iterdir()):
                add(child)
            return
        if path.name.startswith(".env") or path.name in ("id_rsa", "id_ed25519", ".npmrc"):
            raise ValueError(f"Unexpected private input in source tree: {relative}")
        payload[relative] = path.read_bytes()
    for name in (*SOURCE_FILES, *SOURCE_DIRS):
        add(ROOT / name)
    return payload


def write_archive(path, prefix, kind, payload, meta, extra=None):
    records = {name: {"sha256": sha256(data), "size": len(data)} for name, data in sorted(payload.items())}
    manifest = {"schemaVersion": 1, "name": meta["name"], "version": meta["version"], "kind": kind, "files": records}
    if extra:
        manifest.update(extra)
    payload = {**payload, "RELEASE-MANIFEST.json": json_bytes(manifest)}
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(payload.items()):
            info = zipfile.ZipInfo(prefix + "/" + name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def wasm_payload(directory, source_zip, source, inventory):
    receipt = read_json(local_path(directory, "build-info.json"))
    known = {a["id"]: a for a in inventory["artifacts"]}
    if receipt.get("schemaVersion") != 1 or not receipt.get("artifacts"):
        raise ValueError("WASM build-info.json must describe at least one compiled artifact")
    payload = {"wasm/build-info.json": (directory / "build-info.json").read_bytes()}
    found = set()
    for artifact in receipt["artifacts"]:
        artifact_id = artifact["id"]
        if artifact_id not in known or artifact_id in found:
            raise ValueError(f"Unknown or repeated WASM artifact: {artifact_id}")
        found.add(artifact_id)
        recipe = known[artifact_id]
        declared_sources = {entry["path"] for entry in artifact["sourceFiles"]}
        required_sources = set(recipe["sourceFiles"]) | set(recipe.get("buildFiles", [recipe["buildScript"]]))
        if declared_sources != required_sources:
            raise ValueError(f"Incomplete WASM build source receipt: {artifact_id}")
        for record in artifact["sourceFiles"]:
            verify_record(ROOT, record["path"], record)
        expected_outputs = {"msfa.wasm"} if recipe["format"] == "standalone-wasm" else {f"{artifact_id}_wasm.js", f"{artifact_id}_wasm.wasm"}
        if {record["path"] for record in artifact["outputs"]} != expected_outputs:
            raise ValueError(f"WASM output set is incomplete: {artifact_id}")
        for record in artifact["outputs"]:
            verify_record(directory, record["path"], record)
            payload["wasm/" + record["path"]] = local_path(directory, record["path"]).read_bytes()
    # Preserve component notices next to the binary and embed the exact source
    # archive; consumers need no surviving remote repository to obtain it.
    for name, content in source.items():
        if name.startswith("catalog/") or name in ("README.md", "LICENSE", "LICENSE.tools", "LICENSES.md", "CHANGELOG.md", "sdk.json") or name.startswith("vendor/") and any(token in Path(name).name.lower() for token in ("license", "copying", "notice", "authors", "upstream")):
            payload[name] = content
    relative_source = "sources/" + source_zip.name
    payload[relative_source] = source_zip.read_bytes()
    return payload, {"sourceRelease": {"path": relative_source, **file_record(source_zip)}, "artifacts": sorted(found)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=ROOT / "releases")
    parser.add_argument("--wasm-dir", type=Path, help="A fresh build-wasm.sh output directory with build-info.json")
    args = parser.parse_args()
    check_collection()
    meta = metadata()
    source = source_payload()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    base = f"{meta['name']}-{meta['version']}"
    source_zip = args.out_dir / f"{base}-sources.zip"
    write_archive(source_zip, base, "source", source, meta)
    archives = [source_zip]
    if args.wasm_dir:
        payload, extra = wasm_payload(args.wasm_dir.resolve(), source_zip, source, read_json(ROOT / "catalog/source_inventory.json"))
        target = args.out_dir / f"{base}-wasm.zip"
        write_archive(target, base, "wasm", payload, meta, extra)
        archives.append(target)
    lines = [f"{file_record(path)['sha256']}  {path.name}" for path in archives]
    (args.out_dir / "SHA256SUMS").write_text("\n".join(lines) + "\n", encoding="utf-8")
    for path in archives:
        print(path.resolve())
    print(args.out_dir.resolve() / "SHA256SUMS")


if __name__ == "__main__":
    main()
