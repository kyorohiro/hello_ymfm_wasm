import {
  createVirtualFileSystem,
  transferVirtualFiles,
} from '../js/tetorica_virtual_files/filesystem.js';
import { resolvePath, dirname } from '../js/tetorica_virtual_files/path.js';
import {
  createPlaygroundCassetteZip,
  loadPlaygroundCassette,
} from '../playground/playground_cassette.js';
import { parseTfi, createTfiFromPreset } from '../js/tfi.js';
import { parseVgi, createVgiFromPreset } from '../js/vgi.js';
import { readPresetFile } from './synth_preset_import.js';

const TONE_EXTENSION = /\.(tfi|vgi)$/i;
const METADATA_PATHS = new Set(['/metadata.json', '/cassette.metadata.js']);
const comparePaths = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

export function isSynthTonePath(path) {
  return TONE_EXTENSION.test(String(path));
}

function safeName(name, fallback = 'tone') {
  return String(name).replace(/[\\/\x00-\x1f:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '').trim() || fallback;
}

function fileBytes(file) {
  if (file instanceof Uint8Array) return new Uint8Array(file);
  if (file instanceof ArrayBuffer) return new Uint8Array(file.slice(0));
  throw new TypeError('Instrument data must be an ArrayBuffer or Uint8Array.');
}

/**
 * Synth's editable project uses the same virtual filesystem and Cassette ZIP
 * codec as FM Playground. Unknown files, empty directories and .git stay in
 * the project without interpretation. Reading an instrument never rewrites it.
 *
 * @param {{snapshot?: object}} [options]
 */
export function createSynthProject({ snapshot: initialSnapshot } = {}) {
  const fs = createVirtualFileSystem();
  const listeners = new Set();
  let selectedPath = null;
  let cassetteName = 'cassette';
  let cassetteMetadata = null;
  let importSequence = 0;
  let mutationDepth = 0;
  let pendingChange = false;

  const exists = path => fs.has(path) || fs.listDirectories().includes(path);
  function emitChange() {
    if (selectedPath && !exists(selectedPath)) selectedPath = null;
    for (const listener of listeners) listener(project);
  }
  function changed() {
    if (mutationDepth) pendingChange = true;
    else emitChange();
  }
  function mutate(callback) {
    mutationDepth++;
    try { return callback(); }
    finally {
      mutationDepth--;
      if (!mutationDepth && pendingChange) {
        pendingChange = false;
        emitChange();
      }
    }
  }
  fs.onDidChange(changed);

  function uniquePath(path, occupied = new Set([...fs.listDirectories(), ...fs.list().map(file => file.path)])) {
    path = resolvePath(path);
    const baseName = path.slice(path.lastIndexOf('/') + 1);
    const extensionAt = baseName.lastIndexOf('.');
    const extension = extensionAt > 0 ? baseName.slice(extensionAt) : '';
    const stem = extension ? path.slice(0, -extension.length) : path;
    let candidate = path, suffix = 2;
    while (occupied.has(candidate)) candidate = `${stem}-${suffix++}${extension}`;
    return candidate;
  }

  const project = {
    fs,
    get selectedPath() { return selectedPath; },
    get cassetteName() { return cassetteName; },
    get cassetteMetadata() { return cassetteMetadata == null ? null : structuredClone(cassetteMetadata); },
    onDidChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    select(path) {
      if (path != null) {
        path = resolvePath(path);
        fs.stat(path);
      }
      if (selectedPath !== path) {
        selectedPath = path;
        changed();
      }
      return selectedPath;
    },
    uniquePath,
    listTones() {
      return fs.list().filter(file => isSynthTonePath(file.path)).sort((a, b) => comparePaths(a.path, b.path));
    },
    readTone(path) {
      path = resolvePath(path);
      const file = fs.get(path);
      if (!file) throw new Error(`Instrument not found: ${path}`);
      if (!isSynthTonePath(path)) throw new Error('Choose a TFI or VGI instrument file.');
      if (file.type !== 'binary') throw new Error('Instrument files must contain binary TFI/VGI data.');
      const bytes = file.data;
      // Historical Synth imports accepted renamed TFI/VGI files by byte size.
      const format = bytes.byteLength === 43 ? 'vgi' : 'tfi';
      const preset = format === 'vgi' ? parseVgi(bytes) : parseTfi(bytes);
      return { path, format, preset, bytes };
    },
    writeTone(path, preset, { format, overwrite = true, expectedRevision } = {}) {
      path = resolvePath(path);
      if (!isSynthTonePath(path)) throw new Error('Instrument file names must end in .tfi or .vgi.');
      const previous = fs.get(path);
      if (previous && !overwrite) throw new Error(`Instrument already exists: ${path}`);
      // Preserve the real format of an existing renamed file when saving.
      format ??= previous ? project.readTone(path).format : path.match(TONE_EXTENSION)[1].toLowerCase();
      if (format !== 'tfi' && format !== 'vgi') throw new Error('Instrument format must be tfi or vgi.');
      for (const [name, maximum] of [['ams', 3], ['pms', 7]]) {
        if (preset[name] !== undefined && (!Number.isInteger(preset[name]) || preset[name] < 0 || preset[name] > maximum)) {
          throw new Error(`${name} must be an integer in range 0..${maximum}`);
        }
      }
      const previousTone = previous ? project.readTone(path) : null;
      let vgiPreset = preset;
      if (format === 'vgi' && preset.b4 === undefined && previousTone?.format === 'vgi') {
        const old = previousTone.preset;
        const pan = preset.pan ?? old.pan;
        // B4's reserved bit 3 has no Synth control. Keep it, and retain pan or
        // modulation values when the editor only supplies the other fields.
        const b4 = (old.b4 & 0x08)
          | ((pan.left ?? old.pan.left) ? 0x80 : 0)
          | ((pan.right ?? old.pan.right) ? 0x40 : 0)
          | ((preset.ams ?? old.ams) << 4)
          | (preset.pms ?? old.pms);
        vgiPreset = { ...preset, b4 };
      }
      const bytes = format === 'vgi' ? createVgiFromPreset(vgiPreset) : createTfiFromPreset(preset);
      mutate(() => {
        fs.writeBinary(path, bytes, { expectedRevision });
        selectedPath = path;
      });
      return project.readTone(path);
    },
    /**
     * Valid input files are appended in one filesystem commit. A bad file does
     * not replace prior imports. Another import/restore cancels an older load.
     * @param {Iterable<{name:string,arrayBuffer?:Function,data?:Uint8Array|ArrayBuffer}>} files
     * @param {{isCurrent?:Function,directory?:string}} [options]
     */
    async importInstrumentFiles(files, { isCurrent = () => true, directory } = {}) {
      if (directory !== undefined) {
        directory = resolvePath(directory);
        if (fs.stat(directory).type !== 'directory') throw new Error(`Not a folder: ${directory}`);
      }
      const sequence = ++importSequence;
      const current = () => sequence === importSequence && isCurrent();
      const failures = [], batches = [];
      for (const file of files) {
        const name = String(file.name ?? 'instrument.tfi');
        try {
          const bytes = fileBytes(typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : file.data);
          const entries = await readPresetFile(bytes, name);
          if (entries.length) batches.push({ name, entries });
          else failures.push(`${name}: no supported FM instrument snapshots were found.`);
        } catch (error) {
          failures.push(`${name}: ${error.message}`);
        }
        if (!current()) return { paths: [], failures: [], notices: [], cancelled: true };
      }
      batches.sort((a, b) => comparePaths(a.name, b.name));
      const occupied = new Set([...fs.listDirectories(), ...fs.list().map(file => file.path)]);
      const addedFiles = [], addedDirectories = [], notices = new Set();
      for (const batch of batches) {
        const source = safeName(batch.name.replace(/\.(vgm|vgz|s98|tfi|vgi)$/i, ''), 'instrument');
        const directTone = directory !== undefined && TONE_EXTENSION.test(batch.name);
        const base = `${directory ?? '/presets'}/${source}`.replace(/^\/\//, '/');
        let targetDirectory = directTone ? directory : base, suffix = 2;
        while (!directTone && (occupied.has(targetDirectory) || [...occupied].some(path => path.startsWith(`${targetDirectory}/`)))) {
          targetDirectory = `${base}-${suffix++}`;
        }
        occupied.add(targetDirectory);
        addedDirectories.push(targetDirectory);
        batch.entries.sort((a, b) => comparePaths(a.label, b.label));
        for (const entry of batch.entries) {
          const format = entry.format ?? 'tfi';
          const filename = safeName(entry.label.replace(TONE_EXTENSION, ''), 'tone') + `.${format}`;
          const path = uniquePath(`${targetDirectory}/${filename}`, occupied);
          occupied.add(path);
          addedFiles.push({ path, data: fileBytes(entry.bytes ?? createTfiFromPreset(entry.preset)) });
          if (entry.notice) notices.add(entry.notice);
        }
      }
      if (addedFiles.length) mutate(() => {
        fs.replace([...fs.list(), ...addedFiles], [...fs.listDirectories(), ...addedDirectories]);
        selectedPath = addedFiles[0].path;
      });
      return { paths: addedFiles.map(file => file.path), failures, notices: [...notices] };
    },
    duplicate(path, destination) {
      path = resolvePath(path);
      if (destination == null) {
        const filename = path.slice(path.lastIndexOf('/') + 1);
        const extensionAt = filename.lastIndexOf('.');
        const extension = fs.stat(path).type === 'file' && extensionAt > 0 ? filename.slice(extensionAt) : '';
        const stem = extension ? path.slice(0, -extension.length) : path;
        destination = uniquePath(`${stem} copy${extension}`);
      } else destination = resolvePath(destination);
      mutate(() => {
        transferVirtualFiles(fs, path, destination, { copy: true });
        selectedPath = destination;
      });
      return destination;
    },
    move(path, destination) {
      path = resolvePath(path);
      destination = resolvePath(destination);
      const selection = selectedPath;
      mutate(() => {
        transferVirtualFiles(fs, path, destination);
        if (selection === path || selection?.startsWith(`${path}/`)) {
          selectedPath = destination + selection.slice(path.length);
        }
      });
      return destination;
    },
    rename(path, newName) {
      path = resolvePath(path);
      if (typeof newName !== 'string' || !newName.trim() || newName.includes('/') || newName.includes('\\') || /[\x00-\x1f]/.test(newName)) {
        throw new Error('Enter a file or folder name without path separators.');
      }
      newName = newName.trim();
      if (newName === '.' || newName === '..') throw new Error('Invalid file or folder name.');
      const originalExtension = fs.has(path) ? path.match(TONE_EXTENSION)?.[0] : null;
      if (originalExtension && !newName.includes('.')) newName += originalExtension;
      return project.move(path, `${dirname(path)}/${newName}`);
    },
    delete(path, { recursive = false } = {}) {
      fs.remove(resolvePath(path), { recursive });
    },
    mkdir(path) {
      fs.mkdir(resolvePath(path), { recursive: true });
    },
    snapshot() {
      return {
        ...fs.snapshot(),
        selectedPath,
        cassetteName,
        cassetteMetadata: cassetteMetadata == null ? null : structuredClone(cassetteMetadata),
      };
    },
    restore(snapshot) {
      if (snapshot?.version !== 1) throw new Error('Unsupported Synth project snapshot.');
      // The VFS validates every path and conflict before replacing anything.
      const candidate = createVirtualFileSystem();
      candidate.restore(snapshot);
      const selection = snapshot.selectedPath == null ? null : resolvePath(snapshot.selectedPath);
      if (selection) candidate.stat(selection);
      const nextName = String(snapshot.cassetteName ?? 'cassette');
      const nextMetadata = snapshot.cassetteMetadata == null ? null : structuredClone(snapshot.cassetteMetadata);
      importSequence++;
      mutate(() => {
        fs.restore(snapshot);
        selectedPath = selection;
        cassetteName = nextName;
        cassetteMetadata = nextMetadata;
      });
    },
    exportCassette(options = {}) {
      const files = fs.list();
      const hasMetadata = files.some(file => METADATA_PATHS.has(file.path));
      const metadata = options.metadata ?? cassetteMetadata ?? {};
      return createPlaygroundCassetteZip(files, {
        ...options,
        directories: fs.listDirectories(),
        metadata,
        workType: options.workType ?? metadata.workType,
        license: options.license ?? metadata.license,
        licenseName: options.licenseName ?? metadata.licenseName,
        preserveMetadataFiles: hasMetadata,
      });
    },
    async importCassette(bytes, { name, isCurrent = () => true } = {}) {
      const sequence = ++importSequence;
      const cassette = await loadPlaygroundCassette(bytes, { name });
      if (sequence !== importSequence || !isCurrent()) return { cancelled: true };
      const files = Array.from(cassette.files, ([path, data]) => ({ path: `/${path}`, data }));
      for (const file of files.filter(file => isSynthTonePath(file.path))) {
        try {
          if (file.data.byteLength === 43) parseVgi(file.data);
          else parseTfi(file.data);
        } catch (error) {
          throw new Error(`Invalid instrument ${file.path}: ${error.message}`);
        }
      }
      // Validate known instruments, but preserve their original bytes. All
      // other files remain opaque, avoiding JavaScript/metadata re-encoding.
      mutate(() => {
        fs.replace(files, cassette.directories);
        selectedPath = files.filter(file => isSynthTonePath(file.path)).sort((a, b) => comparePaths(a.path, b.path))[0]?.path ?? null;
        cassetteName = cassette.id;
        cassetteMetadata = cassette.metadata;
      });
      return cassette;
    },
  };
  if (initialSnapshot) project.restore(initialSnapshot);
  else fs.mkdir('/presets');
  return project;
}
