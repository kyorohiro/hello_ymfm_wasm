import {normalizeVirtualPath, isCheckpointVirtualPath} from './playground_virtual_files.js';

export const DEFAULT_SAMPLE_ASSET = '/samples/sampler.sample.json';
const format = 'tetorica-sample-v1';
const abort = () => new DOMException('Sample editor project changed', 'AbortError');

function projectPath(path, extension, base) {
  if (typeof path !== 'string' || !path || path.includes('\\') || path.includes('\0') ||
      path.split('/').includes('..')) throw new Error('Choose a project sample path without traversal.');
  const normalized = normalizeVirtualPath(path, base);
  if (normalized === '/sys' || normalized.startsWith('/sys/') || isCheckpointVirtualPath(normalized) ||
      normalized.split('/').includes('.git')) throw new Error('Sample assets cannot use reserved project paths.');
  if (!normalized.toLowerCase().endsWith(extension)) throw new Error(`Sample assets require ${extension} files.`);
  return normalized;
}

export function validateSampleAssetPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('Choose an absolute project sample path.');
  return projectPath(path, '.sample.json');
}

function wavBytes(value) {
  if (!(value instanceof Uint8Array) || value.length < 44 ||
      String.fromCharCode(...value.subarray(0,4)) !== 'RIFF' ||
      String.fromCharCode(...value.subarray(8,12)) !== 'WAVE') throw new Error('Sample source must be WAV bytes.');
  return new Uint8Array(value);
}

function manifest(file) {
  if (!file || file.type !== 'text') throw new Error('Sample asset must be a text manifest.');
  let data;
  try {data = JSON.parse(file.data);} catch {throw new Error('Sample asset is not valid JSON.');}
  if (!data || data.format !== format || typeof data.sourcePath !== 'string' ||
      !data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings) ||
      typeof data.name !== 'string' || !['file','microphone'].includes(data.source)) throw new Error('This JSON file is not a Tetorica sample asset.');
  return data;
}

/** Atomic neutral sample assets. A host session supplies its captured project
 * identity, so a delayed edit cannot write into a newly loaded Cassette. */
export function createPlaygroundSampleAssets({fs, getProjectIdentity, onChanged = () => {}}) {
  function guard({signal,projectIdentity}) {
    signal?.throwIfAborted();
    if (projectIdentity !== getProjectIdentity()) throw abort();
  }
  return {
    async loadAsset(path, context = {}) {
      guard(context); path = validateSampleAssetPath(path);
      const file = fs.get(path);
      if (!file) return null;
      const data = manifest(file);
      const sourcePath = projectPath(data.sourcePath, '.wav', path);
      const source = fs.get(sourcePath);
      if (source?.type !== 'binary') throw new Error('The sample WAV source is missing or is not binary audio.');
      const wav = wavBytes(source.data);
      guard(context);
      return {wav,settings:data.settings,name:data.name,source:data.source};
    },
    async saveAsset({path,wav,settings,name,source}, context = {}) {
      guard(context); path = validateSampleAssetPath(path);
      const bytes = wavBytes(wav);
      if (typeof name !== 'string' || !['file','microphone'].includes(source)) throw new Error('Invalid sample source metadata.');
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Sample settings must be an object.');
      const sourcePath = path.slice(0,-'.sample.json'.length) + '.wav';
      const previous = fs.get(path), previousSource = fs.get(sourcePath);
      if (previous) manifest(previous);
      if (previousSource) {
        if (previousSource.type !== 'binary') throw new Error('Saving a sample cannot overwrite a non-WAV file.');
        wavBytes(previousSource.data);
      }
      const data = JSON.stringify({format,sourcePath,settings,name,source},null,2) + '\n';
      // JSON conversion may call getters; recheck the session before committing.
      guard(context);
      fs.writeFiles([{path:sourcePath,data:bytes},{path,data}]);
      onChanged(path);
      return {path,assetPath:path,sourcePath};
    },
  };
}
