"""Regression tests for release isolation and provenance checks; no compiler needed."""
import hashlib
import json
import copy
import importlib.util
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import wave
import zipfile

import check_standalone_release as checker
from check_standalone_release import (AuditError, REQUIRED_ARTIFACTS, REQUIRED_CHIPS,
                                      REQUIRED_JAVASCRIPT_REFERENCES, REQUIRED_UPSTREAM_REFERENCES, audit_catalog,
                                      audit_compile_commands, audit_genesis_wav, audit_local_sources, audit_manifest, audit_native_file_api,
                                      audit_wasm, relative_path, unpack)


class ReleaseAuditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.root = self.work / "sdk"
        self.root.mkdir()

    def write(self, name, value):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf-8")
        return path

    def fixture(self):
        self.write("sdk.json", json.dumps({"name": "tetorica-soundchip-native", "version": "0.1.0"}))
        source = self.write("vendor/core.cpp", "int sound_chip() { return 1; }\n")
        self.write("vendor/LICENSE", "BSD-3-Clause fixture license\n")
        self.write("scripts/build-wasm.sh", "#!/bin/sh\nset -eu\nem++ vendor/core.cpp -o result.js\n")
        references = {"sourceFiles": ["vendor/core.cpp"], "licenseFiles": ["vendor/LICENSE"]}
        javascript = []
        javascript_components = []
        self.write("reference/javascript/package.json", '{"type":"module","private":true}\n')
        for identifier in sorted(REQUIRED_JAVASCRIPT_REFERENCES):
            entry = f"reference/javascript/{identifier}audioengine.js"
            path = self.write(entry, f"export const referenceId = '{identifier}';\n")
            license_file = f"vendor/{identifier}/LICENSE"
            self.write(license_file, "BSD-3-Clause JavaScript fixture license\n")
            record = {"id": identifier, "format": "javascript-es-module", "entryPoint": entry,
                      "sourceFiles": [entry], "licenseFiles": [license_file],
                      "native": {"status": "not-ported"}, "wasm": {"status": "not-ported"}}
            javascript.append(record)
            javascript_components.append({"id": identifier, "sourceFiles": [entry], "licenseFiles": [license_file],
                                          "files": [{"path": entry, "originPath": f"web/{identifier}audioengine.js",
                                                     "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}]})
        upstream = []
        upstream_components = []
        for identifier in sorted(REQUIRED_UPSTREAM_REFERENCES):
            directory = f"vendor/{identifier}/upstream"
            entry = f"{directory}/core.c"
            path = self.write(entry, '/* BSD-3-Clause upstream source fixture */\n#include "support.h"\n')
            license_file = f"{directory}/LICENSE"
            notice = self.write(license_file, "BSD-3-Clause upstream fixture license\n")
            files = [{"path": "core.c", "upstreamPath": "emu/core.c", "sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
                     {"path": "LICENSE", "upstreamPath": "LICENSE", "sha256": hashlib.sha256(notice.read_bytes()).hexdigest()}]
            snapshot = {"repository": "https://example.invalid/upstream", "commit": "a" * 40,
                        "role": "upstream-source-reference", "files": files,
                        "buildStatus": "reference-only; framework dependencies omitted",
                        "omittedDependencies": [{"path": "support.h", "reason": "fixture dependency not included"}]}
            manifest_name = f"{directory}/snapshot-manifest.json"
            manifest_path = self.write(manifest_name, json.dumps(snapshot))
            record = {key: snapshot[key] for key in ("repository", "commit", "role", "buildStatus", "omittedDependencies")}
            record.update({"id": identifier, "snapshotManifest": manifest_name,
                           "sourceFiles": [entry], "licenseFiles": [license_file],
                           "sdkIntegration": {"native": "not-integrated", "wasm": "not-integrated"}})
            upstream.append(record)
            upstream_components.append({"id": identifier, "sourceFiles": [entry], "licenseFiles": [license_file],
                "files": [{"path": f"{directory}/{item['path']}", "originPath": item["upstreamPath"], "sha256": item["sha256"]} for item in files]
                    + [{"path": manifest_name, "originPath": "snapshot-manifest.json", "sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest()}]})
        catalog = {"schemaVersion": 1, "chips": [{"id": chip, **references} for chip in sorted(REQUIRED_CHIPS)],
                   "javascriptReferences": copy.deepcopy(javascript), "upstreamReferences": copy.deepcopy(upstream)}
        self.write("catalog/chips.json", json.dumps(catalog))
        inventory = {"schemaVersion": 1, "components": [{"id": "core", **references,
                     "files": [{"path": "vendor/core.cpp", "originPath": "src/core.cpp", "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}]}, *javascript_components, *upstream_components],
                     "javascriptReferences": copy.deepcopy(javascript),
                     "upstreamReferences": copy.deepcopy(upstream),
                     "artifacts": [{"id": artifact, "chipIds": sorted(REQUIRED_CHIPS), **references,
                                    "format": "emscripten-es-module", "buildScript": "scripts/build-wasm.sh"} for artifact in sorted(REQUIRED_ARTIFACTS)]}
        self.write("catalog/source_inventory.json", json.dumps(inventory))
        self.write("catalog/native_inventory.json", json.dumps({"schemaVersion": 1, "chips": [
            {"id": chip, "sourceFiles": ["vendor/core.cpp"], "status": "source-only"} for chip in sorted(REQUIRED_CHIPS)]}))
        self.write("native/reference/SOURCES.json", json.dumps({"schemaVersion": 1, "entries": [
            {"file": "vendor/core.cpp", "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}]}))
        return catalog, inventory

    def save_catalogs(self, catalog, inventory):
        self.write("catalog/chips.json", json.dumps(catalog))
        self.write("catalog/source_inventory.json", json.dumps(inventory))

    def manifest(self):
        files = {}
        for path in self.root.rglob("*"):
            if path.is_file() and path != self.root / "RELEASE-MANIFEST.json":
                files[path.relative_to(self.root).as_posix()] = {"size": path.stat().st_size,
                                                              "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        value = {"schemaVersion": 1, "name": "tetorica-soundchip-native", "version": "0.1.0", "kind": "source", "files": files}
        self.write("RELEASE-MANIFEST.json", json.dumps(value))

    def test_valid_manifest_and_every_catalog_source_and_license_can_be_followed(self):
        self.fixture()
        self.manifest()
        audit_manifest(self.root, "source")
        audit_catalog(self.root)
        audit_local_sources(self.root)

    def test_unsafe_paths_are_rejected(self):
        for name in ("../other", "/absolute", "C:/other", "a\\b", "a/../b", "a/./b", "a//b", ""):
            with self.subTest(name=name), self.assertRaises(AuditError):
                relative_path(name)

    def test_zip_traversal_is_rejected_before_any_member_is_extracted(self):
        archive = self.work / "bad.zip"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("sdk/good.txt", "not yet extracted")
            output.writestr("sdk/../../outside.txt", "outside")
        with self.assertRaisesRegex(AuditError, "escapes"):
            unpack(archive, self.work / "unpacked")
        self.assertFalse((self.work / "unpacked").exists())
        self.assertFalse((self.work / "outside.txt").exists())

    def test_zip_symlink_is_rejected(self):
        archive = self.work / "link.zip"
        link = zipfile.ZipInfo("sdk/vendor/core.cpp")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr(link, "../../checkout/core.cpp")
        with self.assertRaisesRegex(AuditError, "Symlink"):
            unpack(archive, self.work / "unpacked")

    def test_zip_multiple_roots_are_rejected(self):
        archive = self.work / "roots.zip"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("sdk/core.cpp", "core")
            output.writestr("another/LICENSE", "license")
        with self.assertRaisesRegex(AuditError, "one SDK root"):
            unpack(archive, self.work / "unpacked")

    def test_same_size_source_tampering_breaks_hash(self):
        self.write("vendor/core.cpp", "one")
        self.manifest()
        self.write("vendor/core.cpp", "two")
        with self.assertRaisesRegex(AuditError, "SHA-256"):
            audit_manifest(self.root, "source")

    def test_missing_and_unlisted_files_are_rejected(self):
        self.write("LICENSE", "license")
        self.manifest()
        self.write("unlisted.cpp", "unlisted")
        with self.assertRaisesRegex(AuditError, "unlisted.cpp"):
            audit_manifest(self.root, "source")
        (self.root / "unlisted.cpp").unlink()
        (self.root / "LICENSE").unlink()
        with self.assertRaisesRegex(AuditError, "LICENSE"):
            audit_manifest(self.root, "source")

    def test_nested_manifest_named_file_is_still_hashed(self):
        self.write("vendor/RELEASE-MANIFEST.json", "component manifest")
        self.manifest()
        audit_manifest(self.root, "source")
        self.write("vendor/RELEASE-MANIFEST.json", "modified component")
        with self.assertRaises(AuditError):
            audit_manifest(self.root, "source")

    def test_missing_or_empty_license_is_rejected(self):
        self.fixture()
        self.write("vendor/LICENSE", "")
        with self.assertRaisesRegex(AuditError, "empty license"):
            audit_catalog(self.root)
        (self.root / "vendor/LICENSE").unlink()
        with self.assertRaisesRegex(AuditError, "licenseFiles"):
            audit_catalog(self.root)

    def test_public_chip_cannot_silently_disappear_from_both_catalogs(self):
        catalog, inventory = self.fixture()
        catalog["chips"] = [chip for chip in catalog["chips"] if chip["id"] != "y8950"]
        inventory["artifacts"][0]["chipIds"].remove("y8950")
        self.write("catalog/chips.json", json.dumps(catalog))
        self.write("catalog/source_inventory.json", json.dumps(inventory))
        with self.assertRaisesRegex(AuditError, "Public chip catalog changed.*y8950"):
            audit_catalog(self.root)

    def test_origin_inventory_hash_matches_packaged_source_bytes(self):
        self.fixture()
        self.write("vendor/core.cpp", "different source")
        with self.assertRaisesRegex(AuditError, "Imported source hash mismatch"):
            audit_catalog(self.root)

    def test_non_public_wasm_artifact_sources_cannot_silently_disappear(self):
        _, inventory = self.fixture()
        inventory["artifacts"] = [item for item in inventory["artifacts"] if item["id"] != "ym3438"]
        self.write("catalog/source_inventory.json", json.dumps(inventory))
        with self.assertRaisesRegex(AuditError, "artifact inventory changed.*ym3438"):
            audit_catalog(self.root)

    def test_javascript_reference_cannot_disappear_from_both_catalogs(self):
        catalog, inventory = self.fixture()
        for document in (catalog, inventory):
            document["javascriptReferences"] = [record for record in document["javascriptReferences"] if record["id"] != "msm5205"]
        self.write("catalog/chips.json", json.dumps(catalog))
        self.write("catalog/source_inventory.json", json.dumps(inventory))
        with self.assertRaisesRegex(AuditError, "JavaScript reference inventory changed"):
            audit_catalog(self.root)

    def test_javascript_catalogs_must_agree_on_source_and_backend_metadata(self):
        catalog, _ = self.fixture()
        catalog["javascriptReferences"][0]["native"]["status"] = "verified"
        self.write("catalog/chips.json", json.dumps(catalog))
        with self.assertRaisesRegex(AuditError, "differ between the two catalogs"):
            audit_catalog(self.root)

    def test_javascript_only_reference_cannot_claim_a_native_or_wasm_port(self):
        for backend in ("native", "wasm"):
            with self.subTest(backend=backend):
                catalog, inventory = self.fixture()
                for document in (catalog, inventory):
                    document["javascriptReferences"][0][backend]["status"] = "verified"
                self.write("catalog/chips.json", json.dumps(catalog))
                self.write("catalog/source_inventory.json", json.dumps(inventory))
                with self.assertRaisesRegex(AuditError, f"must remain {backend} not-ported"):
                    audit_catalog(self.root)

    def test_javascript_entry_point_must_be_present_and_provenanced(self):
        catalog, inventory = self.fixture()
        inventory["components"] = [record for record in inventory["components"] if record["id"] != "msm5205"]
        self.write("catalog/source_inventory.json", json.dumps(inventory))
        with self.assertRaisesRegex(AuditError, "JavaScript source missing from hash provenance"):
            audit_catalog(self.root)
        self.fixture()
        (self.root / "reference/javascript/msm5205audioengine.js").unlink()
        with self.assertRaisesRegex(AuditError, "msm5205audioengine.js"):
            audit_catalog(self.root)

    def test_javascript_source_tampering_breaks_imported_source_hash(self):
        self.fixture()
        self.write("reference/javascript/msm5205audioengine.js", "export const modified = true;\n")
        with self.assertRaisesRegex(AuditError, "Imported source hash mismatch.*msm5205"):
            audit_catalog(self.root)

    def test_javascript_reference_license_must_be_present(self):
        self.fixture()
        (self.root / "vendor/msm5205/LICENSE").unlink()
        with self.assertRaisesRegex(AuditError, "missing/outside licenseFiles.*msm5205"):
            audit_catalog(self.root)

    def test_upstream_reference_cannot_disappear_from_both_catalogs(self):
        catalog, inventory = self.fixture()
        for document in (catalog, inventory):
            document["upstreamReferences"].pop()
        self.save_catalogs(catalog, inventory)
        with self.assertRaisesRegex(AuditError, "upstream reference inventory changed"):
            audit_catalog(self.root)

    def test_upstream_catalogs_must_agree(self):
        catalog, inventory = self.fixture()
        catalog["upstreamReferences"][0]["commit"] = "b" * 40
        self.save_catalogs(catalog, inventory)
        with self.assertRaisesRegex(AuditError, "Upstream references differ"):
            audit_catalog(self.root)

    def test_upstream_reference_requires_full_immutable_commit(self):
        for commit in ("master", "a" * 39, "A" * 40):
            with self.subTest(commit=commit):
                catalog, inventory = self.fixture()
                for document in (catalog, inventory):
                    document["upstreamReferences"][0]["commit"] = commit
                self.save_catalogs(catalog, inventory)
                with self.assertRaisesRegex(AuditError, "full immutable upstream commit"):
                    audit_catalog(self.root)

    def test_upstream_reference_cannot_claim_an_sdk_runtime_port(self):
        for backend in ("native", "wasm"):
            with self.subTest(backend=backend):
                catalog, inventory = self.fixture()
                for document in (catalog, inventory):
                    document["upstreamReferences"][0]["sdkIntegration"][backend] = "verified"
                self.save_catalogs(catalog, inventory)
                with self.assertRaisesRegex(AuditError, "must not claim an SDK runtime port"):
                    audit_catalog(self.root)

    def test_upstream_source_and_manifest_require_hash_provenance(self):
        for source_name in ("core.c", "snapshot-manifest.json"):
            with self.subTest(source=source_name):
                catalog, inventory = self.fixture()
                reference = inventory["upstreamReferences"][0]
                component = next(item for item in inventory["components"] if item["id"] == reference["id"])
                component["files"] = [item for item in component["files"] if not item["path"].endswith("/" + source_name)]
                self.save_catalogs(catalog, inventory)
                with self.assertRaisesRegex(AuditError, "upstream (source|manifest) missing from hash provenance"):
                    audit_catalog(self.root)

    def test_upstream_source_tampering_is_rejected(self):
        _, inventory = self.fixture()
        self.write(inventory["upstreamReferences"][0]["sourceFiles"][0], "modified upstream source\n")
        with self.assertRaisesRegex(AuditError, "Imported source hash mismatch"):
            audit_catalog(self.root)

    def test_upstream_snapshot_cannot_hide_unlisted_sources(self):
        _, inventory = self.fixture()
        reference = inventory["upstreamReferences"][0]
        directory = Path(reference["snapshotManifest"]).parent
        self.write((directory / "unlisted.h").as_posix(), "/* unlisted */\n")
        with self.assertRaisesRegex(AuditError, "snapshot files differ from manifest"):
            audit_catalog(self.root)

    def test_upstream_dependency_limitations_must_be_preserved(self):
        catalog, inventory = self.fixture()
        for document in (catalog, inventory):
            document["upstreamReferences"][0].pop("omittedDependencies")
        self.save_catalogs(catalog, inventory)
        with self.assertRaisesRegex(AuditError, "manifest omittedDependencies differs"):
            audit_catalog(self.root)

    def test_upstream_reference_may_omit_documented_framework_dependencies(self):
        _, inventory = self.fixture()
        for reference in inventory["upstreamReferences"]:
            self.assertFalse((self.root / reference["snapshotManifest"]).parent.joinpath("support.h").exists())
        audit_catalog(self.root)
        audit_local_sources(self.root)

    def test_catalog_refresh_keeps_upstream_references_and_source_bytes(self):
        _, inventory = self.fixture()
        project = Path(__file__).resolve().parents[1]
        for filename in ("sdk_common.py", "refresh_catalog.py"):
            shutil.copyfile(project / "scripts" / filename, self.root / "scripts" / filename)
        originals = {record["path"]: (self.root / record["path"]).read_bytes()
                     for component in inventory["components"] for record in component["files"]}
        subprocess.run([sys.executable, self.root / "scripts/refresh_catalog.py"], check=True, capture_output=True)
        catalog = json.loads((self.root / "catalog/chips.json").read_text())
        self.assertEqual(catalog["upstreamReferences"], inventory["upstreamReferences"])
        self.assertEqual(len(catalog["chips"]), len(REQUIRED_CHIPS))
        for filename, content in originals.items():
            self.assertEqual((self.root / filename).read_bytes(), content)
        audit_catalog(self.root)
        spec = importlib.util.spec_from_file_location("fixture_sdk_common", self.root / "scripts/sdk_common.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.check_collection(self.root)["upstreamReferences"], 3)

    def test_parent_and_absolute_cpp_includes_are_rejected(self):
        for include in ('"../../outside.h"', '"..\\..\\outside.h"', '"/Users/developer/checkout/core.h"', '"C:/checkout/core.h"'):
            with self.subTest(include=include):
                self.write("vendor/core.cpp", f"#include {include}\n")
                with self.assertRaises(AuditError):
                    audit_local_sources(self.root)

    def test_internal_relative_include_is_allowed(self):
        self.write("vendor/core.cpp", '#include "../wasm/interface.h"\n')
        self.write("wasm/interface.h", "#pragma once\n")
        audit_local_sources(self.root)

    def test_cmake_and_shell_cannot_fetch_a_missing_checkout(self):
        for text in ('FetchContent_Declare(core URL https://example.invalid/core.zip)',
                     'ExternalProject_Add(core GIT_REPOSITORY https://example.invalid/core)',
                     'file(DOWNLOAD https://example.invalid/core core.cpp)'):
            with self.subTest(text=text):
                self.write("CMakeLists.txt", text)
                with self.assertRaisesRegex(AuditError, "Network/fetched CMake"):
                    audit_local_sources(self.root)
        (self.root / "CMakeLists.txt").unlink()
        self.write("scripts/build-wasm.sh", "curl https://example.invalid/core.cpp -o core.cpp\n")
        with self.assertRaisesRegex(AuditError, "Network/package download"):
            audit_local_sources(self.root)

    def wasm_fixture(self):
        _, inventory = self.fixture()
        wasm = self.work / "wasm"
        (wasm / "wasm").mkdir(parents=True)
        (wasm / "sources").mkdir()
        archive = self.work / "sources.zip"
        archive.write_bytes(b"companion source fixture")
        (wasm / "sources/sources.zip").write_bytes(archive.read_bytes())
        manifest = {"artifacts": ["ym2612"], "sourceRelease": {"path": "sources/sources.zip", "size": archive.stat().st_size,
                    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest()}}
        source_files = [{"path": name, "size": (self.root / name).stat().st_size,
                         "sha256": hashlib.sha256((self.root / name).read_bytes()).hexdigest()}
                        for name in ("scripts/build-wasm.sh", "vendor/core.cpp")]
        outputs = []
        for name in ("ym2612_wasm.js", "ym2612_wasm.wasm"):
            file = wasm / "wasm" / name
            file.write_bytes(b"fixture output")
            outputs.append({"path": name, "size": file.stat().st_size, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
        info = {"schemaVersion": 1, "artifacts": [{"id": "ym2612", "sourceFiles": source_files, "outputs": outputs,
                "sourceFingerprint": hashlib.sha256(json.dumps(source_files, separators=(",", ":")).encode()).hexdigest(),
                "compiler": {"version": "fixture compiler"}}]}
        (wasm / "wasm/build-info.json").write_text(json.dumps(info))
        return wasm, manifest, archive, inventory

    def test_wasm_release_has_matching_companion_source_and_build_inputs(self):
        wasm, manifest, archive, inventory = self.wasm_fixture()
        audit_wasm(wasm, manifest, self.root, archive, inventory)
        self.write("vendor/core.cpp", "different companion source")
        with self.assertRaisesRegex(AuditError, "build input differs"):
            audit_wasm(wasm, manifest, self.root, archive, inventory)

    def test_wasm_release_cannot_embed_a_different_source_archive(self):
        wasm, manifest, archive, inventory = self.wasm_fixture()
        (wasm / "sources/sources.zip").write_bytes(b"wrong source archive")
        with self.assertRaisesRegex(AuditError, "companion source archive differs"):
            audit_wasm(wasm, manifest, self.root, archive, inventory)

    def test_wasm_release_cannot_include_undeclared_executables(self):
        wasm, manifest, archive, inventory = self.wasm_fixture()
        (wasm / "wasm/another_chip.wasm").write_bytes(b"not declared")
        with self.assertRaisesRegex(AuditError, "undeclared"):
            audit_wasm(wasm, manifest, self.root, archive, inventory)


class NativeBuildPortabilityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="SDK audit test ")
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.root, self.build = self.work / "SDK source", self.work / "native build"
        self.root.mkdir()
        self.build.mkdir()

    def file_api_fixture(self, executable="tetorica_ym2612_fixture.exe", multi_config=True):
        reply = self.build / ".cmake/api/v1/reply"
        reply.mkdir(parents=True, exist_ok=True)
        targets = [{"jsonFile": name} for name in ("fixture-release.json", "fixture-ym2151-release.json",
                                                   "fixture-segapsg-release.json", "fixture-ym2413-release.json",
                                                   "fixture-ay8910-release.json", "fixture-ym2203-release.json", "fixture-ym2608-release.json",
                                                   "fixture-ym2610-release.json", "fixture-okim6258-release.json", "fixture-rf5c164-release.json",
                                                   "fixture-opl-release.json", "fixture-extra_opl-release.json", "fixture-y8950_memory-release.json", "fixture-gameboy-release.json", "fixture-huc6280-release.json", "fixture-nes-release.json",
                                                   "fixture-pwm-release.json", "fixture-extra_pwm-release.json", "fixture-dx7-release.json", "fixture-snes-release.json", "fixture-spc-release.json", "fixture-nuked_ym2612-release.json", "fixture-nuked_colink-release.json", "fixture-wonderswan-release.json", "fixture-pokey-release.json",
                                                   "example-genesis-release.json", "example-master-system-release.json",
                                                   "example-msx-release.json", "example-pc98-ym2203-release.json",
                                                   "example-pc98-ym2608-release.json", "example-neogeo-release.json",
                                                   "example-x68000-release.json", "example-megacd-release.json",
                                                   "example-dos-opl-release.json", "example-msx-audio-release.json", "example-gameboy-release.json", "example-pcengine-release.json", "example-nes-fds-release.json", "example-32x-release.json", "example-dx7-release.json", "example-snes-release.json", "example-spc-release.json", "example-nuked-genesis-release.json", "example-wonderswan-release.json", "example-pokey-release.json")]
        model = {"paths": {"source": str(self.root), "build": str(self.build)}, "configurations": [
            {"name": "Debug", "targets": [{"jsonFile": "fixture-debug.json"}]},
            {"name": "Release", "targets": targets},
        ]}
        if not multi_config:
            model["configurations"] = model["configurations"][1:]
        artifact_directory = "native/Release/" if multi_config else "native/"
        detail = {"name": "tetorica_ym2612_fixture", "nameOnDisk": executable, "type": "EXECUTABLE",
                  "artifacts": [{"path": artifact_directory + executable}],
                  "sources": [{"path": "native/tests/ym2612_fixture.cpp"},
                              {"path": "generated/source.cpp", "isGenerated": True}],
                  "compileGroups": [{"includes": [{"path": str(self.root / "vendor/include files")},
                                                    {"path": str(self.build / "generated")}]}]}
        extra_targets = {}
        for chip in ("ym2151", "segapsg", "ym2413", "ay8910", "ym2203", "ym2608", "ym2610", "okim6258", "rf5c164",
                     "opl", "extra_opl", "y8950_memory", "gameboy", "huc6280", "nes", "pwm", "extra_pwm", "dx7", "snes", "spc", "nuked_ym2612", "nuked_colink", "wonderswan", "pokey"):
            target = copy.deepcopy(detail)
            target["name"] = f"tetorica_{chip}_fixture"
            target["nameOnDisk"] = executable.replace("ym2612", chip)
            target["artifacts"] = [{"path": artifact_directory + target["nameOnDisk"]}]
            target["sources"][0]["path"] = f"native/tests/{chip}_fixture.cpp"
            extra_targets[f"fixture-{chip}-release.json"] = target
        for machine in ("genesis", "master_system", "msx", "pc98_ym2203", "pc98_ym2608", "neogeo", "x68000", "megacd",
                        "dos_opl", "msx_audio", "gameboy", "pcengine", "nes_fds", "32x", "dx7", "snes", "spc", "nuked_genesis", "wonderswan", "pokey"):
            example = copy.deepcopy(detail)
            example["name"] = f"tetorica_{machine}_wav"
            example["nameOnDisk"] = example["name"] + Path(executable).suffix
            example["artifacts"] = [{"path": artifact_directory + example["nameOnDisk"]}]
            example_source = "sega32x" if machine == "32x" else machine
            example["sources"][0]["path"] = f"native/examples/{example_source}_wav.cpp"
            extra_targets[f"example-{machine.replace('_', '-')}-release.json"] = example
        (reply / "index-test.json").write_text(json.dumps({"reply": {"codemodel-v2": {"jsonFile": "model.json"}}}))
        (reply / "model.json").write_text(json.dumps(model))
        (reply / "fixture-release.json").write_text(json.dumps(detail))
        for name, target in extra_targets.items():
            (reply / name).write_text(json.dumps(target))
        # No Debug detail is needed: only the requested Release configuration is built.
        return reply, model, detail

    def test_windows_compiler_quoting_preserves_spaces_quotes_and_backslashes(self):
        arguments = [r"C:\Program Files\MSVC\cl.exe", r"/IC:\SDK source\vendor", "/IC:\\SDK\\",
                     r"/external:IC:\SDK source\headers", r'C:\source files\a"b.cpp', "", "/c"]
        self.assertEqual(checker.windows_command_arguments(subprocess.list2cmdline(arguments)), arguments)
        text = r'"C:\Program Files\MSVC\cl.exe" /I"C:\SDK source\vendor" /c "C:\SDK source\core.cpp"'
        self.assertEqual(checker.windows_command_arguments(text), [arguments[0], arguments[1], "/c", r"C:\SDK source\core.cpp"])

    def test_compile_database_resolves_relative_sources_and_quoted_msvc_includes(self):
        arguments = ["cl.exe", "/I" + str(self.root / "include files"),
                     "/external:I" + str(self.build / "generated headers"), "/c", "native/core.cpp"]
        audit_compile_commands(self.root, self.build, [{"directory": str(self.root), "file": "native/core.cpp",
                                                       "command": subprocess.list2cmdline(arguments)}], windows=True)
        audit_compile_commands(self.root, self.build, [{"directory": str(self.build), "file": "generated/core.cpp",
                                                       "arguments": ["c++", "-I", str(self.root / "include files")]}])

    def test_joined_and_separate_outside_include_options_are_rejected(self):
        outside = str(self.work / "another checkout")
        for arguments in (["cl", "/I" + outside], ["cl", "/external:I" + outside],
                          ["c++", "-isystem" + outside], ["c++", "-iquote", outside]):
            with self.subTest(arguments=arguments), self.assertRaisesRegex(AuditError, "outside include directory"):
                audit_compile_commands(self.root, self.build, [{"directory": str(self.root), "file": "core.cpp",
                                                               "arguments": arguments}])
        with self.assertRaisesRegex(AuditError, "no include path"):
            audit_compile_commands(self.root, self.build, [{"directory": str(self.root), "file": "core.cpp",
                                                           "arguments": ["cl", "/I"]}])

    def test_file_api_discovers_release_exe_without_assuming_a_posix_artifact_path(self):
        for multi_config in (False, True):
            for extension in ("", ".exe"):
                with self.subTest(multi_config=multi_config, extension=extension):
                    self.file_api_fixture("tetorica_ym2612_fixture" + extension, multi_config)
                    directory = "native/Release" if multi_config else "native"
                    self.assertEqual(audit_native_file_api(self.root, self.build), {
                        name: self.build / directory / (name + extension) for name in checker.REQUIRED_NATIVE_EXECUTABLES
                    })

    def test_file_api_requires_ym2151_even_when_ym2612_remains_complete(self):
        reply, model, _ = self.file_api_fixture()
        model["configurations"][1]["targets"] = [target for target in model["configurations"][1]["targets"]
                                                   if target["jsonFile"] != "fixture-ym2151-release.json"]
        (reply / "model.json").write_text(json.dumps(model))
        with self.assertRaisesRegex(AuditError, "missing required executable targets.*tetorica_ym2151_fixture"):
            audit_native_file_api(self.root, self.build)

    def test_file_api_requires_new_fixtures_and_examples_in_single_and_multi_config_builds(self):
        for multi_config in (False, True):
            for filename, target_name in (("fixture-segapsg-release.json", "tetorica_segapsg_fixture"),
                                          ("fixture-ym2413-release.json", "tetorica_ym2413_fixture"),
                                          ("fixture-ay8910-release.json", "tetorica_ay8910_fixture"),
                                          ("fixture-ym2203-release.json", "tetorica_ym2203_fixture"),
                                          ("fixture-ym2608-release.json", "tetorica_ym2608_fixture"),
                                          ("fixture-ym2610-release.json", "tetorica_ym2610_fixture"),
                                          ("fixture-okim6258-release.json", "tetorica_okim6258_fixture"),
                                          ("fixture-rf5c164-release.json", "tetorica_rf5c164_fixture"),
                                          ("fixture-opl-release.json", "tetorica_opl_fixture"),
                                          ("fixture-extra_opl-release.json", "tetorica_extra_opl_fixture"),
                                          ("fixture-y8950_memory-release.json", "tetorica_y8950_memory_fixture"),
                                          ("fixture-gameboy-release.json", "tetorica_gameboy_fixture"),
                                          ("fixture-huc6280-release.json", "tetorica_huc6280_fixture"),
                                          ("fixture-nes-release.json", "tetorica_nes_fixture"),
                                          ("fixture-pwm-release.json", "tetorica_pwm_fixture"),
                                          ("fixture-extra_pwm-release.json", "tetorica_extra_pwm_fixture"),
                                          ("fixture-dx7-release.json", "tetorica_dx7_fixture"),
                                          ("fixture-snes-release.json", "tetorica_snes_fixture"),
                                          ("fixture-spc-release.json", "tetorica_spc_fixture"),
                                          ("fixture-nuked_ym2612-release.json", "tetorica_nuked_ym2612_fixture"),
                                          ("fixture-nuked_colink-release.json", "tetorica_nuked_colink_fixture"),
                                          ("fixture-wonderswan-release.json", "tetorica_wonderswan_fixture"),
                                          ("fixture-pokey-release.json", "tetorica_pokey_fixture"),
                                          ("example-genesis-release.json", "tetorica_genesis_wav"),
                                          ("example-master-system-release.json", "tetorica_master_system_wav"),
                                          ("example-msx-release.json", "tetorica_msx_wav"),
                                          ("example-pc98-ym2203-release.json", "tetorica_pc98_ym2203_wav"),
                                          ("example-pc98-ym2608-release.json", "tetorica_pc98_ym2608_wav"),
                                          ("example-neogeo-release.json", "tetorica_neogeo_wav"),
                                          ("example-x68000-release.json", "tetorica_x68000_wav"),
                                          ("example-megacd-release.json", "tetorica_megacd_wav"),
                                          ("example-dos-opl-release.json", "tetorica_dos_opl_wav"),
                                          ("example-msx-audio-release.json", "tetorica_msx_audio_wav"),
                                          ("example-gameboy-release.json", "tetorica_gameboy_wav"),
                                          ("example-pcengine-release.json", "tetorica_pcengine_wav"),
                                          ("example-nes-fds-release.json", "tetorica_nes_fds_wav"),
                                          ("example-32x-release.json", "tetorica_32x_wav"),
                                          ("example-dx7-release.json", "tetorica_dx7_wav"),
                                          ("example-snes-release.json", "tetorica_snes_wav"),
                                          ("example-spc-release.json", "tetorica_spc_wav"),
                                          ("example-nuked-genesis-release.json", "tetorica_nuked_genesis_wav"),
                                          ("example-wonderswan-release.json", "tetorica_wonderswan_wav"),
                                          ("example-pokey-release.json", "tetorica_pokey_wav")):
                with self.subTest(multi_config=multi_config, target=target_name):
                    reply, model, _ = self.file_api_fixture(multi_config=multi_config)
                    release = next(item for item in model["configurations"] if item["name"] == "Release")
                    release["targets"] = [target for target in release["targets"] if target["jsonFile"] != filename]
                    (reply / "model.json").write_text(json.dumps(model))
                    with self.assertRaisesRegex(AuditError, "missing required executable targets.*" + target_name):
                        audit_native_file_api(self.root, self.build)

    def test_ym2151_requires_a_unique_executable_artifact_and_target(self):
        for error in ("missing artifact", "duplicate artifact", "duplicate target", "outside artifact"):
            with self.subTest(error=error):
                reply, model, _ = self.file_api_fixture()
                path = reply / "fixture-ym2151-release.json"
                detail = json.loads(path.read_text())
                if error == "missing artifact":
                    detail["artifacts"] = []
                elif error == "duplicate artifact":
                    detail["artifacts"] *= 2
                elif error == "duplicate target":
                    model["configurations"][1]["targets"].append({"jsonFile": path.name})
                else:
                    detail["artifacts"][0]["path"] = str(self.work / "tetorica_ym2151_fixture.exe")
                path.write_text(json.dumps(detail))
                (reply / "model.json").write_text(json.dumps(model))
                with self.assertRaisesRegex(AuditError, "tetorica_ym2151_fixture"):
                    audit_native_file_api(self.root, self.build)

    def test_fixture_targets_cannot_alias_one_executable(self):
        reply, _, detail = self.file_api_fixture()
        path = reply / "fixture-ym2151-release.json"
        opm = json.loads(path.read_text())
        opm["nameOnDisk"], opm["artifacts"] = detail["nameOnDisk"], detail["artifacts"]
        path.write_text(json.dumps(opm))
        with self.assertRaisesRegex(AuditError, "share an executable artifact"):
            audit_native_file_api(self.root, self.build)

    def test_file_api_rejects_outside_sources_includes_and_artifacts(self):
        for field in ("source", "include", "artifact"):
            with self.subTest(field=field):
                reply, _, detail = self.file_api_fixture()
                if field == "source":
                    detail["sources"][0]["path"] = str(self.work / "borrowed.cpp")
                elif field == "include":
                    detail["compileGroups"][0]["includes"][0]["path"] = str(self.work / "headers")
                else:
                    detail["artifacts"][0]["path"] = str(self.root / "tetorica_ym2612_fixture.exe")
                (reply / "fixture-release.json").write_text(json.dumps(detail))
                with self.assertRaisesRegex(AuditError, "outside|escapes"):
                    audit_native_file_api(self.root, self.build)

    def test_file_api_requires_the_requested_configuration_and_source_root(self):
        reply, model, _ = self.file_api_fixture()
        model["configurations"] = model["configurations"][:1]
        (reply / "model.json").write_text(json.dumps(model))
        with self.assertRaisesRegex(AuditError, "unique Release configuration"):
            audit_native_file_api(self.root, self.build)
        reply, model, _ = self.file_api_fixture()
        model["paths"]["source"] = str(self.work / "another checkout")
        (reply / "model.json").write_text(json.dumps(model))
        with self.assertRaisesRegex(AuditError, "different source tree"):
            audit_native_file_api(self.root, self.build)

    def test_native_build_uses_release_for_build_and_ctest_with_space_containing_paths(self):
        commands = []

        def execute(arguments, cwd, environment):
            commands.append(list(map(str, arguments)))
            self.assertEqual(cwd, self.build.resolve() if len(commands) >= 4 else self.root.resolve())
            if arguments[0:2] == ["cmake", "-S"]:
                self.file_api_fixture()
            elif arguments[0:2] == ["cmake", "--build"]:
                for name in checker.REQUIRED_NATIVE_EXECUTABLES:
                    fixture = self.build / "native/Release" / (name + ".exe")
                    fixture.parent.mkdir(parents=True, exist_ok=True)
                    fixture.write_bytes(b"fixture executable")
            elif len(commands) >= 4:
                self.write_wav(Path(arguments[1]))

        with patch.object(checker, "command", side_effect=execute):
            checker.build_native(self.root, self.build, {})
        self.assertIn("-DTETORICA_NATIVE_BUILD_EXAMPLES=ON", commands[0])
        self.assertEqual(commands[1], ["cmake", "--build", str(self.build.resolve()), "--config", "Release", "--parallel", "2"])
        self.assertEqual(commands[2], ["ctest", "--test-dir", str(self.build.resolve()), "-C", "Release", "--output-on-failure", "--no-tests=error"])
        self.assertEqual(commands[3], [str(self.build.resolve() / "native/Release/tetorica_genesis_wav.exe"),
                                       str(self.build.resolve() / "genesis example output.wav")])
        self.assertEqual(commands[4], [str(self.build.resolve() / "native/Release/tetorica_master_system_wav.exe"),
                                       str(self.build.resolve() / "master system example output.wav")])
        self.assertEqual(commands[5], [str(self.build.resolve() / "native/Release/tetorica_msx_wav.exe"),
                                       str(self.build.resolve() / "msx example output.wav")])
        self.assertEqual(commands[6], [str(self.build.resolve() / "native/Release/tetorica_pc98_ym2203_wav.exe"),
                                       str(self.build.resolve() / "pc-98 ym2203 example output.wav")])
        self.assertEqual(commands[7], [str(self.build.resolve() / "native/Release/tetorica_pc98_ym2608_wav.exe"),
                                       str(self.build.resolve() / "pc-98 ym2608 example output.wav")])
        self.assertEqual(commands[8], [str(self.build.resolve() / "native/Release/tetorica_neogeo_wav.exe"),
                                       str(self.build.resolve() / "neogeo example output.wav")])
        self.assertEqual(commands[9], [str(self.build.resolve() / "native/Release/tetorica_x68000_wav.exe"),
                                       str(self.build.resolve() / "x68000 example output.wav")])
        self.assertEqual(commands[10], [str(self.build.resolve() / "native/Release/tetorica_megacd_wav.exe"),
                                        str(self.build.resolve() / "mega-cd example output.wav")])
        self.assertEqual(commands[11], [str(self.build.resolve() / "native/Release/tetorica_dos_opl_wav.exe"),
                                        str(self.build.resolve() / "dos pc opl example output.wav")])
        self.assertEqual(commands[12], [str(self.build.resolve() / "native/Release/tetorica_msx_audio_wav.exe"),
                                        str(self.build.resolve() / "msx-audio example output.wav")])
        self.assertEqual(commands[13], [str(self.build.resolve() / "native/Release/tetorica_gameboy_wav.exe"),
                                        str(self.build.resolve() / "game boy example output.wav")])
        self.assertEqual(commands[14], [str(self.build.resolve() / "native/Release/tetorica_pcengine_wav.exe"),
                                        str(self.build.resolve() / "pc engine example output.wav")])
        self.assertEqual(commands[15], [str(self.build.resolve() / "native/Release/tetorica_nes_fds_wav.exe"),
                                        str(self.build.resolve() / "nes with fds example output.wav")])
        self.assertEqual(commands[16], [str(self.build.resolve() / "native/Release/tetorica_32x_wav.exe"),
                                        str(self.build.resolve() / "32x example output.wav")])
        self.assertEqual(commands[17], [str(self.build.resolve() / "native/Release/tetorica_dx7_wav.exe"),
                                        str(self.build.resolve() / "dx7 example output.wav")])
        self.assertEqual(commands[18], [str(self.build.resolve() / "native/Release/tetorica_snes_wav.exe"),
                                        str(self.build.resolve() / "snes example output.wav")])
        self.assertEqual(commands[19], [str(self.build.resolve() / "native/Release/tetorica_spc_wav.exe"),
                                        str(self.build.resolve() / "spc example output.wav")])
        self.assertEqual(commands[20], [str(self.build.resolve() / "native/Release/tetorica_nuked_genesis_wav.exe"),
                                        str(self.build.resolve() / "nuked genesis example output.wav")])
        self.assertEqual(commands[21], [str(self.build.resolve() / "native/Release/tetorica_wonderswan_wav.exe"),
                                        str(self.build.resolve() / "wonderswan example output.wav")])
        self.assertEqual(commands[22], [str(self.build.resolve() / "native/Release/tetorica_pokey_wav.exe"),
                                        str(self.build.resolve() / "dual pokey example output.wav")])

    def test_native_build_rejects_an_unbuilt_ym2151_fixture_before_running_ctest(self):
        commands = []

        def execute(arguments, cwd, environment):
            commands.append(list(map(str, arguments)))
            if arguments[0:2] == ["cmake", "-S"]:
                self.file_api_fixture()
            elif arguments[0:2] == ["cmake", "--build"]:
                for name in checker.REQUIRED_NATIVE_EXECUTABLES - {"tetorica_ym2151_fixture"}:
                    fixture = self.build / "native/Release" / (name + ".exe")
                    fixture.parent.mkdir(parents=True, exist_ok=True)
                    fixture.write_bytes(b"fixture executable")

        with patch.object(checker, "command", side_effect=execute):
            with self.assertRaisesRegex(AuditError, "not built.*tetorica_ym2151_fixture"):
                checker.build_native(self.root, self.build, {})
        self.assertEqual(len(commands), 2)

    def test_native_build_rejects_unbuilt_new_targets_before_ctest_for_both_config_layouts(self):
        for multi_config in (False, True):
            for missing in ("tetorica_segapsg_fixture", "tetorica_ym2413_fixture", "tetorica_ay8910_fixture",
                            "tetorica_ym2203_fixture", "tetorica_ym2608_fixture", "tetorica_ym2610_fixture",
                            "tetorica_okim6258_fixture", "tetorica_rf5c164_fixture",
                            "tetorica_opl_fixture", "tetorica_extra_opl_fixture", "tetorica_y8950_memory_fixture", "tetorica_gameboy_fixture", "tetorica_huc6280_fixture", "tetorica_nes_fixture",
                            "tetorica_pwm_fixture", "tetorica_extra_pwm_fixture", "tetorica_dx7_fixture", "tetorica_snes_fixture", "tetorica_spc_fixture", "tetorica_nuked_ym2612_fixture", "tetorica_nuked_colink_fixture", "tetorica_wonderswan_fixture", "tetorica_pokey_fixture",
                            "tetorica_master_system_wav", "tetorica_msx_wav", "tetorica_pc98_ym2203_wav",
                            "tetorica_pc98_ym2608_wav", "tetorica_neogeo_wav", "tetorica_x68000_wav", "tetorica_megacd_wav",
                            "tetorica_dos_opl_wav", "tetorica_msx_audio_wav", "tetorica_gameboy_wav", "tetorica_pcengine_wav", "tetorica_nes_fds_wav", "tetorica_32x_wav", "tetorica_dx7_wav", "tetorica_snes_wav", "tetorica_spc_wav", "tetorica_nuked_genesis_wav", "tetorica_wonderswan_wav", "tetorica_pokey_wav"):
                with self.subTest(multi_config=multi_config, missing=missing):
                    self.build = self.work / f"native build {multi_config} {missing}"
                    self.build.mkdir()
                    commands = []

                    def execute(arguments, cwd, environment):
                        commands.append(list(map(str, arguments)))
                        if arguments[0:2] == ["cmake", "-S"]:
                            self.file_api_fixture(multi_config=multi_config)
                        elif arguments[0:2] == ["cmake", "--build"]:
                            directory = "native/Release" if multi_config else "native"
                            for name in checker.REQUIRED_NATIVE_EXECUTABLES - {missing}:
                                fixture = self.build / directory / (name + ".exe")
                                fixture.parent.mkdir(parents=True, exist_ok=True)
                                fixture.write_bytes(b"fixture executable")

                    with patch.object(checker, "command", side_effect=execute):
                        with self.assertRaisesRegex(AuditError, "not built.*" + missing):
                            checker.build_native(self.root, self.build, {})
                    self.assertEqual(len(commands), 2)

    def test_native_build_validates_later_wavs_after_running_their_examples(self):
        for label, failing_command in (("Master System", 5), ("MSX", 6), ("PC-98 YM2203", 7), ("PC-98 YM2608", 8),
                                       ("NeoGeo", 9), ("X68000", 10), ("Mega-CD", 11),
                                       ("DOS PC OPL", 12), ("MSX-AUDIO", 13), ("Game Boy", 14), ("PC Engine", 15),
                                       ("NES with FDS", 16), ("32X", 17), ("DX7", 18), ("SNES", 19), ("SPC", 20), ("Nuked Genesis", 21), ("WonderSwan", 22), ("Dual POKEY", 23)):
            with self.subTest(label=label):
                self.build = self.work / f"invalid {label} example build"
                self.build.mkdir()
                commands = []

                def execute(arguments, cwd, environment):
                    commands.append(list(map(str, arguments)))
                    if arguments[0:2] == ["cmake", "-S"]:
                        self.file_api_fixture()
                    elif arguments[0:2] == ["cmake", "--build"]:
                        for name in checker.REQUIRED_NATIVE_EXECUTABLES:
                            executable = self.build / "native/Release" / (name + ".exe")
                            executable.parent.mkdir(parents=True, exist_ok=True)
                            executable.write_bytes(b"fixture executable")
                    elif len(commands) >= 4:
                        self.write_wav(Path(arguments[1]), samples=(0, 0) if len(commands) == failing_command else (1000, -2000))

                with patch.object(checker, "command", side_effect=execute):
                    with self.assertRaisesRegex(AuditError, label + ".*nonzero PCM"):
                        checker.build_native(self.root, self.build, {})
                self.assertEqual(len(commands), failing_command)

    def test_pokey_parity_uses_discovered_executable_in_both_config_layouts(self):
        for multi_config in (False, True):
            with self.subTest(multi_config=multi_config):
                self.build = self.work / f"POKEY parity build {multi_config}"
                self.build.mkdir()
                self.file_api_fixture(multi_config=multi_config)
                fixtures = audit_native_file_api(self.root, self.build)
                fixture = fixtures["tetorica_pokey_fixture"]
                fixture.parent.mkdir(parents=True, exist_ok=True)
                fixture.write_bytes(b"fixture executable")
                wasm = self.work / "WASM release with spaces"
                with patch.object(checker, "command") as execute:
                    checker.check_pokey_parity(self.root, fixtures, wasm, {})
                self.assertEqual(execute.call_args.args[0], ["node", self.root / "tests/check_pokey_core.mjs",
                    "--fixture", fixture, "--wasm-dir", wasm])
                self.assertTrue(str(fixture).endswith("tetorica_pokey_fixture.exe"))

    def test_pokey_parity_rejects_missing_executable_before_running_node(self):
        self.file_api_fixture()
        fixtures = audit_native_file_api(self.root, self.build)
        with patch.object(checker, "command") as execute:
            with self.assertRaisesRegex(AuditError, "POKEY parity fixture was not built"):
                checker.check_pokey_parity(self.root, fixtures, self.work / "wasm", {})
        execute.assert_not_called()

    def test_pokey_parity_build_only_selects_the_pokey_fixture(self):
        fixture = self.build / "native/Release/tetorica_pokey_fixture.exe"
        fixture.parent.mkdir(parents=True)
        fixture.write_bytes(b"fixture executable")
        fixtures = {"tetorica_pokey_fixture": fixture}
        with patch.object(checker, "prepare_native_build", return_value=fixtures), patch.object(checker, "command") as execute:
            self.assertEqual(checker.build_pokey_fixture(self.root, self.build, {}), fixtures)
        self.assertEqual(execute.call_args_list[0].args[0], ["cmake", "--build", self.build.resolve(),
            "--config", "Release", "--target", "tetorica_pokey_fixture", "--parallel", "2"])
        self.assertEqual(execute.call_args_list[1].args[0], [fixture, "--self-test"])

    def write_wav(self, path, *, channels=2, rate=48000, width=2, frames=48000, samples=(1000, -2000)):
        frame = b"".join(samples[channel].to_bytes(2, "little", signed=True) for channel in range(channels)) if width == 2 else b"\x01" * channels * width
        with wave.open(str(path), "wb") as audio:
            audio.setnchannels(channels)
            audio.setsampwidth(width)
            audio.setframerate(rate)
            audio.writeframes(frame * frames)

    def test_genesis_wav_requires_pcm16_stereo_48khz_and_a_full_second(self):
        path = self.build / "example output.wav"
        with self.assertRaisesRegex(AuditError, "did not write its WAV"):
            audit_genesis_wav(path)
        self.write_wav(path)
        result = audit_genesis_wav(path)
        self.assertEqual(result["frames"], 48000)
        self.assertEqual(result["channelPeaks"], [1000 / 32768, 2000 / 32768])
        for settings in ({"channels": 1}, {"rate": 44100}, {"width": 1}, {"frames": 47999}):
            with self.subTest(settings=settings):
                self.write_wav(path, **settings)
                with self.assertRaisesRegex(AuditError, "PCM16 stereo|at least one second"):
                    audit_genesis_wav(path)

    def test_genesis_wav_rejects_silent_channels_clipping_and_truncated_payloads(self):
        path = self.build / "example output.wav"
        for samples in ((0, 0), (1000, 0), (32767, -32768)):
            with self.subTest(samples=samples):
                self.write_wav(path, samples=samples)
                with self.assertRaisesRegex(AuditError, "both channels|clipped"):
                    audit_genesis_wav(path)
        self.write_wav(path)
        data = path.read_bytes()
        path.write_bytes(data[:-4])
        with self.assertRaisesRegex(AuditError, "truncated"):
            audit_genesis_wav(path)
        path.write_bytes(b"not a WAV")
        with self.assertRaisesRegex(AuditError, "Invalid Genesis example WAV"):
            audit_genesis_wav(path)

    def test_relative_work_directory_is_resolved_before_changing_command_cwd(self):
        previous = Path.cwd()
        self.addCleanup(checker.os.chdir, previous)
        checker.os.chdir(self.work)
        arguments = ["checker", "--source-zip", "sources.zip", "--work-dir", "relative output", "--audit-only"]
        with patch.object(sys, "argv", arguments), patch.object(checker, "unpack", side_effect=RuntimeError("stop before audit")) as extract:
            with self.assertRaisesRegex(RuntimeError, "stop before audit"):
                checker.main()
        self.assertEqual(extract.call_args.args[1], self.work.resolve() / "relative output/source")


if __name__ == "__main__":
    unittest.main()
