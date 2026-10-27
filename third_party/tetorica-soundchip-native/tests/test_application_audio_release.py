"""Application-audio catalog/release regressions; no compiler, Node or network.

The old release fixture is composed rather than inherited, so these cases do
not duplicate the entire existing ReleaseAuditTests suite during discovery.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
from contextlib import redirect_stdout
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import sdk_common
import check_standalone_release as checker
import test_standalone_release as legacy

ROOT = Path(__file__).resolve().parents[1]


class ApplicationAudioReleaseTests(unittest.TestCase):
    def setUp(self):
        self.helper = legacy.ReleaseAuditTests(methodName="runTest")
        self.helper.setUp()
        self.addCleanup(self.helper.doCleanups)
        self.root, self.work = self.helper.root, self.helper.work
        self.catalog, self.inventory = self.helper.fixture()
        self.native = json.loads((self.root / "catalog/native_inventory.json").read_text())
        # Actual two-module metadata is exercised against synthetic local bytes.
        # This preserves the real schema while keeping tests independent of all
        # SDK cores, generated WASM outputs, compilers and another checkout.
        for name, target in (("source_inventory", self.inventory), ("native_inventory", self.native), ("chips", self.catalog)):
            target["applicationAudio"] = json.loads((ROOT / f"catalog/{name}.json").read_text())["applicationAudio"]
        for record in self.inventory["applicationAudio"]:
            native = next(item for item in self.native["applicationAudio"] if item["id"] == record["id"])
            names = set(record["sourceFiles"] + record["licenseFiles"] + record["buildFiles"]
                        + native["sourceFiles"] + native["licenseFiles"] + native["buildFiles"]
                        + native["tests"] + [native["publicHeader"]])
            for name in sorted(names):
                self.helper.write(name, f"Fixture input for {name}\n")
            sources = set(record["sourceFiles"] + record["licenseFiles"])
            self.inventory["components"].append({
                "id": "application-" + record["id"],
                "sourceFiles": list(record["sourceFiles"]),
                "licenseFiles": list(record["licenseFiles"]),
                "files": [{"path": name, "originPath": "native/fixture/" + Path(name).name,
                           "sha256": hashlib.sha256((self.root / name).read_bytes()).hexdigest()}
                          for name in sorted(sources)],
            })
        for document in (self.catalog, self.inventory):
            next(item for item in document["javascriptReferences"] if item["id"] == "msm5205").update({
                "native": {"status": "separate-application-module", "module": "msm5205"},
                "wasm": {"status": "separate-application-module", "module": "msm5205"},
            })
        self.save()

    def save(self):
        for name, data in (("chips", self.catalog), ("source_inventory", self.inventory), ("native_inventory", self.native)):
            self.helper.write(f"catalog/{name}.json", json.dumps(data))

    def rejected_by_both(self, collection_message, release_message):
        self.save()
        with self.assertRaisesRegex(ValueError, collection_message):
            sdk_common.check_collection(self.root)
        with self.assertRaisesRegex(checker.AuditError, release_message):
            checker.audit_catalog(self.root)

    def test_two_audio_modules_are_separate_from_unchanged_generic_chip_ids(self):
        result = sdk_common.check_collection(self.root)
        catalog, inventory = checker.audit_catalog(self.root)
        self.assertEqual(result["applicationAudio"], 2)
        self.assertEqual({item["id"] for item in catalog["applicationAudio"]}, {"cdda", "msm5205"})
        self.assertEqual({item["id"] for item in catalog["chips"]}, sdk_common.CHIP_IDS)
        self.assertTrue({"cdda", "msm5205"}.isdisjoint(sdk_common.CHIP_IDS))
        self.assertEqual({item["id"] for item in inventory["artifacts"]}, checker.REQUIRED_ARTIFACTS)
        self.assertTrue(all(item["chipIds"] == [] for item in inventory["applicationAudio"]))

    def test_missing_one_module_is_rejected_even_if_all_catalogs_drop_it(self):
        for document in (self.catalog, self.inventory, self.native):
            document["applicationAudio"] = [item for item in document["applicationAudio"] if item["id"] != "cdda"]
        self.rejected_by_both("include CD-DA and MSM5205", "Application audio source inventory changed")

    def test_duplicate_native_or_public_audio_records_cannot_be_hidden_by_id_maps(self):
        for label, document in (("native", self.native), ("catalog", self.catalog)):
            with self.subTest(catalog=label):
                document["applicationAudio"].append(copy.deepcopy(document["applicationAudio"][0]))
                self.rejected_by_both("exactly once", f"Application audio {label} inventory changed")
                document["applicationAudio"].pop()

    def test_audio_cannot_claim_generic_chip_ids_or_pollute_the_public_chip_list(self):
        record = self.inventory["applicationAudio"][0]
        record["chipIds"] = ["huc6280"]
        self.rejected_by_both("separate standalone PCM API", "separate standalone PCM API")
        record["chipIds"] = []
        self.catalog["chips"].append({"id": "cdda", "sourceFiles": record["sourceFiles"], "licenseFiles": record["licenseFiles"]})
        self.rejected_by_both("all 24 SDK chip IDs", "Public chip catalog changed")

    def test_pcm_audio_cannot_masquerade_as_a_generic_emscripten_chip_artifact(self):
        self.inventory["applicationAudio"][0]["format"] = "emscripten-es-module"
        self.rejected_by_both("separate standalone PCM API", "separate standalone PCM API")

    def test_native_alias_and_public_header_must_identify_the_selected_audio_module(self):
        native = self.native["applicationAudio"][0]
        original = copy.deepcopy(native)
        for key, invalid in (("cmakeAlias", "tetorica::huc6280"), ("publicHeader", "native/include/tetorica/msm5205.h")):
            with self.subTest(field=key):
                native[key] = invalid
                self.catalog["applicationAudio"][0]["native"] = copy.deepcopy(native)
                self.rejected_by_both("invalid Native target|public header", "Native target mismatch|public header")
                native.clear(); native.update(copy.deepcopy(original))
                self.catalog["applicationAudio"][0]["native"] = copy.deepcopy(native)

    def test_public_and_native_metadata_cannot_disagree(self):
        self.catalog["applicationAudio"][0]["native"]["status"] = "source-only"
        self.rejected_by_both("catalogs differ", "catalogs differ")

    def test_missing_audio_license_is_rejected(self):
        path = self.root / self.inventory["applicationAudio"][0]["licenseFiles"][0]
        path.unlink()
        self.rejected_by_both("Missing collection file", "Missing imported source|licenseFiles reference")

    def test_unhashed_audio_source_is_rejected_even_when_the_file_exists(self):
        path = self.inventory["applicationAudio"][0]["sourceFiles"][0]
        component = next(item for item in self.inventory["components"] if item["id"] == "application-cdda")
        component["files"] = [item for item in component["files"] if item["path"] != path]
        self.rejected_by_both("hash provenance", "hash provenance")

    def test_audio_source_bytes_cannot_change_without_updated_provenance(self):
        path = self.root / self.inventory["applicationAudio"][1]["sourceFiles"][0]
        path.write_bytes(path.read_bytes() + b"changed")
        self.rejected_by_both("Snapshot checksum mismatch", "Imported source hash mismatch")

    def wasm_fixture(self):
        wasm = self.work / "wasm"
        (wasm / "wasm").mkdir(parents=True)
        (wasm / "sources").mkdir()
        archive = self.work / "audited-source.zip"
        archive.write_bytes(b"audited companion source archive fixture")
        (wasm / "sources/source.zip").write_bytes(archive.read_bytes())
        manifest = {"artifacts": ["cdda", "msm5205"], "sourceRelease": {
            "path": "sources/source.zip", "size": archive.stat().st_size,
            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        }}
        records = []
        for recipe in self.inventory["applicationAudio"]:
            sources = [{"path": name, "size": (self.root / name).stat().st_size,
                        "sha256": hashlib.sha256((self.root / name).read_bytes()).hexdigest()}
                       for name in sorted(set(recipe["sourceFiles"] + recipe["buildFiles"]))]
            outputs = []
            for extension in ("js", "wasm"):
                name = f"{recipe['id']}_wasm.{extension}"
                path = wasm / "wasm" / name
                path.write_bytes(b"fixture loader" if extension == "js" else b"\0asm\1\0\0\0")
                outputs.append({"path": name, "size": path.stat().st_size,
                                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
            records.append({"id": recipe["id"], "sourceFiles": sources, "outputs": outputs,
                "sourceFingerprint": hashlib.sha256(json.dumps(sources, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest(),
                "compiler": {"version": "fixture C11 WASM compiler"}})
        (wasm / "wasm/build-info.json").write_text(json.dumps({"schemaVersion": 1, "artifacts": records}))
        return wasm, manifest, archive

    def test_pcm_only_wasm_release_has_two_loaders_and_matching_companion_inputs(self):
        wasm, manifest, archive = self.wasm_fixture()
        checker.audit_wasm(wasm, manifest, self.root, archive, self.inventory)
        self.assertEqual({p.name for p in (wasm / "wasm").iterdir()}, {
            "build-info.json", "cdda_wasm.js", "cdda_wasm.wasm", "msm5205_wasm.js", "msm5205_wasm.wasm"})

    def test_pcm_only_wasm_release_rejects_a_different_companion_source_archive(self):
        wasm, manifest, archive = self.wasm_fixture()
        (wasm / "sources/source.zip").write_bytes(b"different source")
        with self.assertRaisesRegex(checker.AuditError, "companion source archive differs"):
            checker.audit_wasm(wasm, manifest, self.root, archive, self.inventory)

    def test_audio_wasm_build_inputs_must_match_the_paired_source(self):
        wasm, manifest, archive = self.wasm_fixture()
        path = self.root / self.inventory["applicationAudio"][1]["sourceFiles"][-1]
        path.write_bytes(path.read_bytes() + b"wrong bridge")
        with self.assertRaisesRegex(checker.AuditError, "build input differs from companion source"):
            checker.audit_wasm(wasm, manifest, self.root, archive, self.inventory)

    def test_audio_wasm_provenance_cannot_omit_a_header_even_with_a_refreshed_fingerprint(self):
        wasm, manifest, archive = self.wasm_fixture()
        path = wasm / "wasm/build-info.json"
        info = json.loads(path.read_text())
        record = info["artifacts"][0]
        record["sourceFiles"] = [item for item in record["sourceFiles"] if not item["path"].endswith(".h")]
        record["sourceFingerprint"] = hashlib.sha256(json.dumps(record["sourceFiles"], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        path.write_text(json.dumps(info))
        with self.assertRaisesRegex(checker.AuditError, "omitted a source/build input"):
            checker.audit_wasm(wasm, manifest, self.root, archive, self.inventory)

    def test_audio_smoke_dispatch_selects_only_application_modules_and_optional_parity(self):
        output = self.work / "released-wasm"
        with patch.object(checker, "command") as command:
            checker.check_application_audio(self.root, output, ["ym2612", "msm5205", "cdda"], {}, parity=True)
        calls = [list(map(str, call.args[0])) for call in command.call_args_list]
        self.assertEqual(len(calls), 4)
        self.assertEqual(calls[0][-1], "cdda")
        self.assertEqual(calls[1][-2:], ["--artifact", "cdda"])
        self.assertEqual(calls[2][-1], "msm5205")
        self.assertEqual(calls[3][-2:], ["--artifact", "msm5205"])
        self.assertTrue(all("wasm_smoke.mjs" not in Path(call[1]).name or "application_audio" in Path(call[1]).name for call in calls))
        with patch.object(checker, "command") as command:
            checker.check_application_audio(self.root, output, ["ym2612", "pokey"], {}, parity=False)
            command.assert_not_called()

    def cli_application_parity(self, supplied=(), build=None, index=0):
        """Exercise main's real flag admission/dispatch with audited input seams.

        Catalog/source integrity has separate real-file tests above. Here only
        extraction, compilation and subprocesses are replaced so admission can
        be checked without a compiler, ZIP build or dependency on Node.
        """
        work = self.work / f"cli-{index}"
        args = argparse.Namespace(
            source_zip=self.work / "source.zip", wasm_zip=self.work / "wasm.zip" if supplied else None,
            work_dir=work, audit_only=True, wasm_smoke=False, javascript_smoke=False,
            build_wasm=build, pokey_native_parity=False, application_audio_parity=True,
        )
        source = self.work / "tetorica-soundchip-native-0.1.0"
        wasm = self.work / "unpacked-wasm"
        manifest = {"name": "tetorica-soundchip-native", "version": "0.1.0", "artifacts": list(supplied)}
        def command(values, cwd, environment):
            if str(values[0]) == "sh":
                output = work / "rebuilt-wasm"
                output.mkdir(parents=True)
                (output / "fixture.wasm").write_bytes(b"fixture built artifact")
        with patch.object(checker.argparse.ArgumentParser, "parse_args", return_value=args), \
             patch.object(checker, "unpack", side_effect=[source, wasm]), \
             patch.object(checker, "audit_manifest", return_value=manifest), \
             patch.object(checker, "audit_catalog", return_value=(self.catalog, self.inventory)), \
             patch.object(checker, "audit_local_sources"), \
             patch.object(checker, "audit_wasm"), \
             patch.object(checker.shutil, "which", return_value="fixture-tool"), \
             patch.object(checker, "command", side_effect=command) as commands, \
             redirect_stdout(io.StringIO()):
            checker.main()
        return [list(map(str, call.args[0])) for call in commands.call_args_list]

    def test_application_parity_flag_rejects_no_supplied_or_rebuilt_audio(self):
        with self.assertRaisesRegex(checker.AuditError, "needs supplied or rebuilt CD-DA/MSM5205"):
            self.cli_application_parity()

    def test_application_parity_flag_rejects_only_non_audio_artifacts(self):
        with self.assertRaisesRegex(checker.AuditError, "needs supplied or rebuilt CD-DA/MSM5205"):
            self.cli_application_parity(supplied=("ym2612",), build="ym2612")

    def test_application_parity_flag_accepts_each_audio_source_and_rebuild_selector(self):
        cases = [(("cdda",), None, {"cdda"}), (("msm5205",), None, {"msm5205"}),
                 ((), "cdda", {"cdda"}), ((), "msm5205", {"msm5205"}), ((), "all", {"cdda", "msm5205"})]
        for index, (supplied, build, expected) in enumerate(cases):
            with self.subTest(supplied=supplied, build=build):
                calls = self.cli_application_parity(supplied, build, index)
                parity = [call for call in calls if Path(call[1]).name == "check_application_audio_core.mjs"]
                self.assertEqual({call[-1] for call in parity}, expected)
                self.assertEqual(len(parity), len(expected))


if __name__ == "__main__":
    unittest.main()
