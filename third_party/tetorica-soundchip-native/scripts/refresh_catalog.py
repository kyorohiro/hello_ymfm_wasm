#!/usr/bin/env python3
"""Rebuild the chip entry point from the two explicit source inventories."""
from sdk_common import ROOT, CHIP_IDS, json_bytes, read_json


def main():
    inventory = read_json(ROOT / "catalog/source_inventory.json")
    native = {entry["id"]: entry for entry in read_json(ROOT / "catalog/native_inventory.json")["chips"]}
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
    data = {"schemaVersion": 1, "stage": "bootstrap", "chips": chips, "additionalArtifacts": additional,
            "javascriptReferences": javascript,
            "upstreamReferences": upstream,
            "differencesDocument": "docs/chip-differences.md",
            "notes": ["Source collection is complete for these 22 Playground IDs; each Native verificationScope records its supported API and tested configurations.",
                      "A WASM recipe is not a claim of runtime verification; release build-info and tests report the verified scope.",
                      "snes (DSP/RAM access) and spc (SPC CPU/file player) share the SNES-SPC sources but remain separate APIs.",
                      "JavaScript references are separate from the 22 Playground IDs and 27 WASM recipes; their Native/WASM ports are not implemented.",
                      "Pinned upstream source references preserve original C/C++ implementations and dependencies; they are not additional SDK Native/WASM targets."]}
    (ROOT / "catalog/chips.json").write_bytes(json_bytes(data))
    print(f"Catalog written: {len(chips)} Playground chips, {len(additional)} additional WASM artifacts, {len(javascript)} JavaScript references, {len(upstream)} upstream source references")


if __name__ == "__main__":
    main()
