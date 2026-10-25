#!/usr/bin/env python3
"""Import a hash-pinned local SDK source ZIP, or verify the vendored copy offline."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NAME = 'tetorica-soundchip-native'
SNAPSHOT = Path('third_party') / NAME
RECEIPT = Path('third_party/soundchip-sdk.json')
MANIFEST = 'RELEASE-MANIFEST.json'
# The full release is pinned and checked; these inputs additionally identify a
# complete set of migrated WASM inputs instead of a partial bundle.
REQUIRED = {
    'sdk.json', 'LICENSE', 'LICENSES.md', 'catalog/chips.json',
    'catalog/source_inventory.json', 'scripts/build-wasm.sh',
    'scripts/record_wasm_build.mjs',
    'wasm/ym2612_wasm.cpp', 'wasm/ym2203_wasm.cpp', 'wasm/ym2608_wasm.cpp',
    'wasm/ym2610b_wasm.cpp', 'wasm/ym2151_wasm.cpp', 'wasm/okim6258_wasm.cpp',
    'wasm/ym2413_wasm.cpp', 'wasm/ym3526_wasm.cpp', 'wasm/ym3812_wasm.cpp',
    'wasm/opn_state.h', 'wasm/ymfm_wasm_interface.h',
    'scripts/build_ym2612_wasm.sh', 'scripts/build_ym2203_wasm.sh',
    'scripts/build_ym2608_wasm.sh', 'scripts/build_ym2610b_wasm.sh',
    'scripts/build_ym2151_wasm.sh', 'scripts/build_okim6258_wasm.sh',
    'scripts/build_ym2413_wasm.sh', 'scripts/build_ym3526_wasm.sh',
    'scripts/build_ym3812_wasm.sh',
    'vendor/mame-okim6258/LICENSE', 'vendor/mame-okim6258/okim6258.cpp',
    'vendor/mame-okim6258/okim6258.h',
    'vendor/ymfm/LICENSE',
    'vendor/ymfm/chip_state.h', 'vendor/ymfm/ymfm.h',
    'vendor/ymfm/ymfm_fm.h', 'vendor/ymfm/ymfm_fm.ipp',
    *('vendor/ymfm/ymfm_' + chip + extension
      for chip in ('adpcm', 'misc', 'opl', 'opm', 'opn', 'opq', 'opz', 'pcm', 'ssg')
      for extension in ('.cpp', '.h')),
    'vendor/ymfm/ymfm_opx.h',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'Duplicate JSON key: ' + key)
        result[key] = value
    return result


def read_json(data):
    return json.loads(data, object_pairs_hook=unique_object)


def relative(value):
    require(isinstance(value, str) and value and '\\' not in value and '\0' not in value
            and ':' not in value, 'Unsafe SDK path: ' + repr(value))
    path = PurePosixPath(value)
    require(bool(path.parts) and not path.is_absolute() and '..' not in path.parts and str(path) == value,
            'Unsafe SDK path: ' + value)
    return path


def manifest_records(raw):
    manifest = read_json(raw)
    require(isinstance(manifest, dict) and manifest.get('schemaVersion') == 1 and manifest.get('kind') == 'source'
            and manifest.get('name') == NAME, 'Expected an SDK source-release manifest')
    require(isinstance(manifest.get('version'), str)
            and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.+_-]*', manifest['version']),
            'Invalid SDK release version')
    files = manifest.get('files')
    require(isinstance(files, dict) and REQUIRED <= set(files) and MANIFEST not in files,
            'SDK source release is incomplete')
    for name, record in files.items():
        relative(name)
        require(isinstance(record, dict) and type(record.get('size')) is int
                and record['size'] >= 0 and isinstance(record.get('sha256'), str)
                and re.fullmatch('[0-9a-f]{64}', record['sha256']),
                'Invalid SDK file record: ' + name)
    return manifest


def validate_payload(payload, manifest):
    records = manifest['files']
    require(set(payload) == set(records) | {MANIFEST}, 'SDK file set differs from manifest')
    for name, record in records.items():
        data = payload[name]
        require(len(data) == record['size'] and digest(data) == record['sha256'],
                'SDK content hash/size mismatch: ' + name)
    metadata = read_json(payload['sdk.json'])
    require(isinstance(metadata, dict) and metadata.get('name') == NAME and metadata.get('version') == manifest['version'],
            'SDK metadata and release manifest differ')


def archive_payload(archive, checksum):
    require(re.fullmatch('[0-9a-f]{64}', checksum) is not None, 'Expected a lowercase SHA-256')
    data = archive.read_bytes()
    require(digest(data) == checksum, 'SDK archive SHA-256 mismatch')
    with zipfile.ZipFile(io.BytesIO(data)) as zipped:
        entries = zipped.infolist()
        names = [entry.filename for entry in entries]
        require(len(names) == len(set(names)), 'Duplicate SDK ZIP member')
        require(len(names) == len({name.casefold() for name in names}),
                'Case-colliding SDK ZIP members')
        for entry in entries:
            relative(entry.filename)
            require(stat.S_IFMT(entry.external_attr >> 16) == stat.S_IFREG,
                    'SDK ZIP member is not a regular file: ' + entry.filename)
        manifests = [name for name in names if name.endswith('/' + MANIFEST)]
        require(len(manifests) == 1, 'Expected exactly one SDK release manifest')
        raw = zipped.read(manifests[0])
        manifest = manifest_records(raw)
        prefix = NAME + '-' + manifest['version'] + '/'
        require(manifests[0] == prefix + MANIFEST and all(name.startswith(prefix) for name in names),
                'SDK ZIP root differs from release identity')
        payload = {name[len(prefix):]: zipped.read(name) for name in names}
        validate_payload(payload, manifest)
    return payload, manifest


def check_installed(root=ROOT):
    directory = root / SNAPSHOT
    for path in (directory.parent,):
        require(not path.is_symlink(), 'SDK parent must not be a symbolic link: ' + str(path))
    require(not directory.is_symlink() and directory.is_dir(), 'Missing vendored SDK directory')
    pin_path = root / RECEIPT
    require(not pin_path.is_symlink(), 'SDK pin must be a regular file')
    pin = read_json(pin_path.read_bytes())
    require(isinstance(pin, dict) and pin.get('schemaVersion') == 1 and pin.get('name') == NAME
            and isinstance(pin.get('sourceCommit'), str)
            and re.fullmatch('[0-9a-f]{40}', pin['sourceCommit'])
            and isinstance(pin.get('archiveSha256'), str)
            and re.fullmatch('[0-9a-f]{64}', pin['archiveSha256']),
            'Invalid SDK pin receipt')
    payload = {}
    for path in directory.rglob('*'):
        require(not path.is_symlink(), 'SDK snapshot contains a symbolic link: ' + str(path))
        if path.is_file():
            payload[path.relative_to(directory).as_posix()] = path.read_bytes()
        else:
            require(path.is_dir(), 'SDK snapshot contains a non-regular entry: ' + str(path))
    require(MANIFEST in payload and digest(payload[MANIFEST]) == pin.get('manifestSha256'),
            'SDK release manifest differs from pin')
    manifest = manifest_records(payload[MANIFEST])
    require(manifest['version'] == pin.get('version') and len(payload) == pin.get('fileCount'),
            'SDK pin version/file count differs')
    validate_payload(payload, manifest)
    return pin


def import_archive(archive, checksum, source_commit, root=ROOT):
    require(re.fullmatch('[0-9a-f]{40}', source_commit) is not None,
            'Expected the declared 40-character SDK source commit')
    payload, manifest = archive_payload(archive, checksum)
    destination = root / SNAPSHOT
    receipt = root / RECEIPT
    for path in (destination.parent,):
        require(not path.is_symlink(), 'SDK parent must not be a symbolic link: ' + str(path))
    # Downstream changes belong outside this immutable snapshot. Refuse to
    # overwrite missing pin records or locally modified imported sources.
    if destination.exists() or destination.is_symlink() or receipt.exists() or receipt.is_symlink():
        check_installed(root)
    pin = {'schemaVersion': 1, 'name': NAME, 'version': manifest['version'],
           'sourceCommit': source_commit, 'archiveName': archive.name,
           'archiveSha256': checksum, 'manifestSha256': digest(payload[MANIFEST]),
           'fileCount': len(payload)}
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.soundchip-sdk-', dir=destination.parent) as temporary:
        candidate = Path(temporary) / 'snapshot'
        candidate.mkdir()
        for name, data in payload.items():
            target = candidate.joinpath(*relative(name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        candidate_pin = Path(temporary) / 'pin.json'
        candidate_pin.write_text(json.dumps(pin, indent=2) + '\n', encoding='utf-8')
        previous = Path(temporary) / 'previous'
        if destination.exists():
            destination.rename(previous)
        try:
            candidate.rename(destination)
            candidate_pin.replace(receipt)
        except Exception:
            if destination.exists():
                shutil.rmtree(destination)
            if previous.exists():
                previous.rename(destination)
            raise
    check_installed(root)
    return pin


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='verify the committed snapshot offline')
    parser.add_argument('--archive', type=Path, help='local SDK sources ZIP; no download is performed')
    parser.add_argument('--sha256', help='expected source-archive SHA-256')
    parser.add_argument('--source-commit', help='declared SDK source revision, recorded as provenance')
    args = parser.parse_args()
    if args.check:
        if args.archive or args.sha256 or args.source_commit:
            parser.error('--check cannot be combined with import options')
        pin = check_installed()
    else:
        if not all((args.archive, args.sha256, args.source_commit)):
            parser.error('import requires --archive, --sha256 and --source-commit')
        pin = import_archive(args.archive, args.sha256, args.source_commit)
    print(f"SDK {pin['version']}: {pin['fileCount']} pinned files verified offline "
          f"(archive SHA256 {pin['archiveSha256']})")


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        raise SystemExit(str(error))
