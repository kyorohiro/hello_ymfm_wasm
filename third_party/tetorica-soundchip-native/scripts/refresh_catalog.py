#!/usr/bin/env python3
"""Rebuild the chip entry point from the two explicit source inventories."""
from sdk_common import ROOT, CHIP_IDS, json_bytes, read_json


def main():
    inventory = read_json(ROOT / "catalog/source_inventory.json")
    native = {entry["id"]: entry for entry in read_json(ROOT / "catalog/native_inventory.json")["chips"]}
    native_audio = {entry["id"]: entry for entry in read_json(ROOT / "catalog/native_inventory.json").get("applicationAudio", [])}
    chips = []
    for chip_id in sorted(CHIP_IDS):
        artifacts = [a for a in inventory["artifacts"] if chip_id in a.get("chipIds", [])]
        if not artifacts:
            raise ValueError(f"No WASM source recipe for {chip_id}")
        sources = sorted(set(native[chip_id]["sourceFiles"]).union(*(set(a["sourceFiles"]) for a in artifacts)))
        licenses = sorted(set(native[chip_id].get("licenseFiles", [])).union(*(set(a["licenseFiles"]) for a in artifacts)))
        entry = {
            "id": chip_id, "sourceFiles": sources, "licenseFiles": licenses,
            "native": native[chip_id],
            "wasm": {"status": "build-recipes-included", "artifacts": [
                {"id": a["id"], "format": a["format"], "buildScript": a["buildScript"]} for a in artifacts
            ]},
        }
        if chip_id == "ym2612":
            entry["engines"] = ["ymfm", "nuked-opn2"]
        chips.append(entry)
    additional = [{"id": a["id"], "chipIds": a["chipIds"], "sourceFiles": a["sourceFiles"],
                   "licenseFiles": a["licenseFiles"], "buildScript": a["buildScript"], "format": a["format"]}
                  for a in inventory["artifacts"] if not set(a.get("chipIds", [])).intersection(CHIP_IDS)]
    javascript = inventory.get("javascriptReferences", [])
    upstream = inventory.get("upstreamReferences", [])
    audio = [{"id": entry["id"], "role": "application-audio", "kind": entry["kind"],
              "sourceFiles": sorted(set(entry["sourceFiles"] + native_audio[entry["id"]]["sourceFiles"])),
              "licenseFiles": entry["licenseFiles"], "native": native_audio[entry["id"]],
              "wasm": {"status": "build-recipes-included", "artifacts": [{key: entry[key] for key in ("id", "format", "buildScript")}]}}
             for entry in inventory.get("applicationAudio", [])]
    instruments = [{"id": entry["id"], "role": "instrument", "kind": entry["kind"],
                    "sourceFiles": entry["sourceFiles"], "licenseFiles": entry["licenseFiles"],
                    "native": next(device for device in read_json(ROOT / "catalog/native_inventory.json").get("instruments", []) if device["id"] == entry["id"]),
                    "wasm": {"status": "build-recipes-included", "artifacts": [{key: entry[key] for key in ("id", "format", "buildScript")}]}}
                   for entry in inventory.get("instruments", [])]
    data = {"schemaVersion": 1, "stage": "bootstrap", "chips": chips, "additionalArtifacts": additional,
            "javascriptReferences": javascript,
            "upstreamReferences": upstream,
            "applicationAudio": audio, "instruments": instruments,
            "differencesDocument": "docs/chip-differences.md",
            "notes": ["Source collection covers these 24 SDK chip IDs; each Native verificationScope records its supported API and tested configurations. POKEY is a standalone SDK addition, not an application-mode integration.",
                      "A WASM recipe is not a claim of runtime verification; release build-info and tests report the verified scope.",
                      "snes (DSP/RAM access) and spc (SPC CPU/file player) share the SNES-SPC sources but remain separate APIs.",
                      "Two application-audio modules, CD-DA and MSM5205, are separate from the 24 SDK chip IDs and 29 chip WASM recipes; they add two standalone C/WASM recipes without changing existing chip APIs.",
                      "The MSM5205 JavaScript reference remains unchanged and serves as a behavioral reference for the separate C application module. OKIM6295 remains a JavaScript/upstream reference without an SDK Native/WASM target.",
                      "Pinned upstream source references preserve original C/C++ implementations and dependencies; they are not additional SDK Native/WASM targets."]}
    (ROOT / "catalog/chips.json").write_bytes(json_bytes(data))
    print(f"Catalog written: {len(chips)} SDK chips, {len(additional)} additional chip WASM artifacts, {len(audio)} application-audio modules, {len(javascript)} JavaScript references, {len(upstream)} upstream source references")


if __name__ == "__main__":
    main()
