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
    'wasm/ymf262_wasm.cpp', 'wasm/y8950_wasm.cpp', 'wasm/ay8910_wasm.cpp',
    'wasm/segapsg_wasm.cpp', 'wasm/segapcm_wasm.cpp',
    'wasm/rf5c164_wasm.cpp', 'wasm/pwm32x_wasm.cpp', 'wasm/pwm32x_core.h',
    'wasm/huc6280_wasm.cpp', 'wasm/gameboy_apu_wasm.cpp',
    'wasm/nesapu_wasm.cpp', 'wasm/spc_wasm.cpp', 'wasm/k051649_wasm.cpp',
    'wasm/opn_variant_wasm.cpp', 'wasm/ymf278b_wasm.cpp',
    'wasm/nuked_opn2_wasm.c',
    'wasm/opn_state.h', 'wasm/ymfm_wasm_interface.h',
    'scripts/build_ym2612_wasm.sh', 'scripts/build_ym2203_wasm.sh',
    'scripts/build_ym2608_wasm.sh', 'scripts/build_ym2610b_wasm.sh',
    'scripts/build_ym2151_wasm.sh', 'scripts/build_okim6258_wasm.sh',
    'scripts/build_ym2413_wasm.sh', 'scripts/build_ym3526_wasm.sh',
    'scripts/build_ym3812_wasm.sh', 'scripts/build_ymf262_wasm.sh',
    'scripts/build_y8950_wasm.sh', 'scripts/build_ay8910_wasm.sh',
    'scripts/build_segapsg_wasm.sh', 'scripts/build_segapcm_wasm.sh',
    'scripts/build_rf5c164_wasm.sh', 'scripts/build_pwm32x_wasm.sh',
    'scripts/build_huc6280_wasm.sh', 'scripts/build_gameboy_apu_wasm.sh',
    'scripts/build_nesapu_wasm.sh', 'scripts/build_spc_wasm.sh',
    'scripts/build_k051649_wasm.sh', 'scripts/build_ym3438_wasm.sh',
    'scripts/build_ymf276_wasm.sh', 'scripts/build_ymf288_wasm.sh',
    'scripts/build_ymf278b_wasm.sh', 'scripts/build_nuked_opn2_wasm.sh',
    'scripts/build_dx7_wasm.sh', 'wasm/dx7/dx7.cc', 'wasm/dx7/dx7.h',
    'scripts/build_opn_variant_wasm.sh',
    *('vendor/msfa/' + name for name in (
        'aligned_buf.h', 'controllers.h', 'dx7note.cc', 'dx7note.h', 'env.cc',
        'env.h', 'exp2.cc', 'exp2.h', 'fm_core.cc', 'fm_core.h',
        'fm_op_kernel.cc', 'fm_op_kernel.h', 'freqlut.cc', 'freqlut.h',
        'lfo.cc', 'lfo.h', 'module.h', 'patch.cc', 'patch.h', 'pitchenv.cc',
        'pitchenv.h', 'resofilter.cc', 'resofilter.h', 'ringbuffer.cc',
        'ringbuffer.h', 'sin.cc', 'sin.h', 'synth.h', 'synth_unit.cc',
        'synth_unit.h', 'COPYING', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
        'UPSTREAM.md')),
    'vendor/mame-32x-pwm/LICENSE',
    'vendor/nuked-opn2/LICENSE', 'vendor/nuked-opn2/README.md',
    'vendor/nuked-opn2/ym3438.c', 'vendor/nuked-opn2/ym3438.h',
    'vendor/mame-ay8910/LICENSE', 'vendor/mame-ay8910/ay8910.cpp',
    'vendor/mame-ay8910/ay8910.h',
    'vendor/mame-gameboy/LICENSE', 'vendor/mame-gameboy/gameboy_apu.cpp',
    'vendor/mame-gameboy/gameboy_apu.h',
    'vendor/mame-huc6280/LICENSE', 'vendor/mame-huc6280/huc6280.cpp',
    'vendor/mame-huc6280/huc6280.h',
    'vendor/mame-k051649/LICENSE', 'vendor/mame-k051649/README.md',
    'vendor/mame-k051649/k051649.cpp', 'vendor/mame-k051649/k051649.h',
    'vendor/mame-k051649/upstream/k051649.cpp',
    'vendor/mame-k051649/upstream/k051649.h',
    'vendor/mame-okim6258/LICENSE', 'vendor/mame-okim6258/okim6258.cpp',
    'vendor/mame-okim6258/okim6258.h',
    'vendor/mame-rf5c164/LICENSE', 'vendor/mame-rf5c164/rf5c164.cpp',
    'vendor/mame-rf5c164/rf5c164.h',
    'vendor/mame-segapcm/LICENSE', 'vendor/mame-segapcm/segapcm.cpp',
    'vendor/mame-segapcm/segapcm.h',
    'vendor/tetorica-nes/nes_core.cpp', 'vendor/tetorica-nes/nes_core.h',
    'vendor/tetorica-nes/LICENSE-JSNES', 'vendor/tetorica-nes/LICENSE-FDS',
    'vendor/tetorica-nes/AUTHORS-JSNES.md',
    # Preserve the whole LGPL core source/notice tree, including the optional
    # upstream source files that the accurate-DSP recipe does not compile.
    *('vendor/snes-spc/' + name for name in (
        'LICENSE', 'README.md', 'README.upstream.md', 'changes.txt',
        'license.txt', 'readme.txt', 'snes_spc.txt',
        'snes_spc/SNES_SPC.cpp', 'snes_spc/SNES_SPC.h',
        'snes_spc/SNES_SPC_misc.cpp', 'snes_spc/SNES_SPC_state.cpp',
        'snes_spc/SPC_CPU.h', 'snes_spc/SPC_DSP.cpp', 'snes_spc/SPC_DSP.h',
        'snes_spc/SPC_Filter.cpp', 'snes_spc/SPC_Filter.h',
        'snes_spc/blargg_common.h', 'snes_spc/blargg_config.h',
        'snes_spc/blargg_endian.h', 'snes_spc/blargg_source.h',
        'snes_spc/dsp.cpp', 'snes_spc/dsp.h', 'snes_spc/spc.cpp',
        'snes_spc/spc.h')),
    'vendor/ymfm/LICENSE',
    'vendor/ymfm/chip_state.h', 'vendor/ymfm/ymfm.h',
    'vendor/ymfm/ymfm_fm.h', 'vendor/ymfm/ymfm_fm.ipp',
    *('vendor/ymfm/ymfm_' + chip + extension
      for chip in ('adpcm', 'misc', 'opl', 'opm', 'opn', 'opq', 'opz', 'pcm', 'ssg')
      for extension in ('.cpp', '.h')),
    'vendor/ymfm/ymfm_opx.h',
}
LEGACY_SEGA_PSG = {'vendor/ymfm/segapsg.cpp', 'vendor/ymfm/segapsg.h'}
SEPARATED_SEGA_PSG = {
    'vendor/tetorica_sega_psg/segapsg.cpp', 'vendor/tetorica_sega_psg/segapsg.h',
    'vendor/tetorica_sega_psg/LICENSE', 'vendor/tetorica_sega_psg/README.md',
}
POKEY_INPUTS = {
    'wasm/pokey_wasm.cpp', 'scripts/build_pokey_wasm.sh',
    'vendor/libvgm-pokey/pokey.cpp', 'vendor/libvgm-pokey/pokey.h',
    'vendor/libvgm-pokey/LICENSE', 'vendor/libvgm-pokey/README.md',
    'vendor/libvgm-pokey/upstream/pokey.c',
    'vendor/libvgm-pokey/upstream/snapshot-manifest.json',
}
PS1_INPUTS = {
    'scripts/build_ps1_spu_wasm.sh', 'tests/ps1_spu_wasm_smoke.mjs',
    'native/include/tetorica/ps1_spu.h',
    *('vendor/mame-ps1-spu/' + name for name in (
        'ps1_spu.cpp', 'ps1_spu.h', 'spu.cpp', 'spu.h', 'spu_tables.cpp',
        'spureverb.cpp', 'spureverb.h', 'standalone_support.h', 'LICENSE', 'README.md',
        'upstream/spu.cpp', 'upstream/spu.h', 'upstream/spu_tables.cpp',
        'upstream/spureverb.cpp', 'upstream/spureverb.h', 'upstream/REVISION',
        'upstream/SHA256SUMS')),
}
SCSP_INPUTS = {
    'scripts/build_scsp_wasm.sh', 'tests/scsp_wasm_smoke.mjs',
    'native/include/tetorica/scsp.h', 'native/tests/scsp_fixture.cpp',
    'native/examples/scsp_pattern.hpp',
    *('vendor/mame-scsp/' + name for name in (
        'scsp_instrument.cpp', 'scsp_instrument.h', 'scsp.cpp', 'scsp.h',
        'scspdsp.cpp', 'scspdsp.h', 'standalone_support.h', 'LICENSE', 'README.md',
        'upstream/scsp.cpp', 'upstream/scsp.h', 'upstream/scspdsp.cpp',
        'upstream/scspdsp.h', 'upstream/REVISION', 'upstream/SHA256SUMS')),
}
APPLICATION_AUDIO_INPUTS = {
    name: {
        f'vendor/tetorica-{name}/{name}_pcm.c',
        f'vendor/tetorica-{name}/{name}_pcm.h',
        f'vendor/tetorica-{name}/LICENSE',
        f'vendor/tetorica-{name}/NOTICE.md',
        f'vendor/tetorica-{name}/README.md',
        f'wasm/{name}_wasm.c', f'scripts/build_{name}_wasm.sh',
        'tests/application_audio_wasm_smoke.mjs',
        'tests/check_application_audio_core.mjs',
    } for name in ('cdda', 'msm5205')
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
    # An update still verifies the previous immutable snapshot before replacing
    # it. Accept complete historical or separated PSG inputs, never a mixture.
    names = set(files)
    # Historical fixed snapshots must remain verifiable before an update.
    # A POKEY-capable release must include its adaptation and licensed original.
    if POKEY_INPUTS & names:
        require(POKEY_INPUTS <= names, 'SDK POKEY source release is incomplete')
    # Existing immutable snapshots must still verify before replacement. When
    # a release contains either application-audio module, require its complete
    # licensed source, standalone WASM bridge and self-contained checks.
    if PS1_INPUTS & names:
        require(PS1_INPUTS <= names, 'SDK PS1 SPU source release is incomplete')
    if SCSP_INPUTS & names:
        require(SCSP_INPUTS <= names, 'SDK SCSP source release is incomplete')
    for audio, inputs in APPLICATION_AUDIO_INPUTS.items():
        module_paths = {name for name in inputs if name.startswith((
            f'vendor/tetorica-{audio}/', f'wasm/{audio}_',
            f'scripts/build_{audio}_'))}
        if module_paths & names:
            require(inputs <= names, f'SDK {audio} source release is incomplete')
    require((LEGACY_SEGA_PSG <= names and not SEPARATED_SEGA_PSG & names)
            or (SEPARATED_SEGA_PSG <= names and not LEGACY_SEGA_PSG & names),
            'SDK source release is incomplete or mixes Sega PSG layouts')
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
    validate_local_candidate(pin.get('localCandidate'), pin['sourceCommit'], manifest)
    return pin


def validate_local_candidate(candidate, source_commit, manifest):
    if candidate is None:
        return
    require(isinstance(candidate, dict)
            and set(candidate) == {'baseCommit', 'changedPaths'}
            and candidate['baseCommit'] == source_commit,
            'Invalid SDK local-candidate base commit')
    paths = candidate['changedPaths']
    require(isinstance(paths, list) and paths and all(isinstance(name, str) for name in paths)
            and paths == sorted(set(paths)), 'Invalid SDK local-candidate changed paths')
    for name in paths:
        relative(name)
        require(name in manifest['files'], 'Local-candidate changed path absent from source archive: ' + name)


def import_archive(archive, checksum, source_commit, root=ROOT, *, local_changed_paths=None):
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
    if local_changed_paths is not None:
        # This is an immutable hash-pinned archive, but not the exact contents
        # of sourceCommit. Label that revision as its base instead of implying
        # a committed/tagged release that does not yet exist.
        pin['localCandidate'] = {'baseCommit': source_commit,
                                 'changedPaths': sorted(local_changed_paths)}
        validate_local_candidate(pin['localCandidate'], source_commit, manifest)
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
    parser.add_argument('--local-changed-path', action='append',
                        help='source path changed from --source-commit; marks an unpublished local candidate (repeatable)')
    args = parser.parse_args()
    if args.check:
        if args.archive or args.sha256 or args.source_commit or args.local_changed_path:
            parser.error('--check cannot be combined with import options')
        pin = check_installed()
    else:
        if not all((args.archive, args.sha256, args.source_commit)):
            parser.error('import requires --archive, --sha256 and --source-commit')
        pin = import_archive(args.archive, args.sha256, args.source_commit,
                             local_changed_paths=args.local_changed_path)
    label = ' (unpublished local candidate; sourceCommit is its base)' if pin.get('localCandidate') else ''
    print(f"SDK {pin['version']}{label}: {pin['fileCount']} pinned files verified offline "
          f"(archive SHA256 {pin['archiveSha256']})")


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        raise SystemExit(str(error))
