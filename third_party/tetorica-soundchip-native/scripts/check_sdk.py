#!/usr/bin/env python3
"""Verify collected sources, license references and provenance checksums."""
import argparse
from pathlib import Path
from sdk_common import ROOT, check_collection


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    result = check_collection(args.root.resolve())
    print("Collection OK: {chips} chips, {artifacts} WASM recipes, {javascriptReferences} JavaScript references, {snapshotFiles} snapshot files checked".format(**result))


if __name__ == "__main__":
    main()
