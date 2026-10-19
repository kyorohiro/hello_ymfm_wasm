const isTextFile = file => typeof file?.data === 'string' &&
  (file.type === undefined || file.type === 'text');
const parents = path => {
  const result = [];
  for (let end = path.lastIndexOf('/'); end > 0; end = path.lastIndexOf('/', end - 1)) {
    result.push(path.slice(0, end));
  }
  return result;
};
const sources = value => (Array.isArray(value) ? value : [value]).filter(value => typeof value === 'string');

/** Replace only untouched starter code when a project changes mode.
 * Existing text, binary assets, checkpoints and project metadata remain user data.
 * `defaults` maps each mode ID to its current source, or to an array containing
 * that source followed by older bundled starters. `legacyDefaults` recognizes
 * old projects that have no recorded source mode.
 */
export function reconcileModeProject(snapshot, {
  sourceModeId = snapshot.modeId,
  targetModeId,
  defaults = {},
  legacyDefaults = [],
  allExampleFiles = [],
  targetExampleFiles = [],
} = {}) {
  const defaultEntries = defaults instanceof Map ? [...defaults] : Object.entries(defaults);
  const defaultMap = new Map(defaultEntries);
  const targetSource = sources(defaultMap.get(targetModeId))[0];
  const sourceKnown = defaultMap.has(sourceModeId);
  const recognizedSources = new Set(sourceKnown
    ? sources(defaultMap.get(sourceModeId))
    : [...defaultEntries.flatMap(([, value]) => sources(value)), ...sources(legacyDefaults)]);
  const targetPaths = new Set(targetExampleFiles.map(file => file.path));
  const bundledSources = new Map();
  for (const file of allExampleFiles) {
    if (!isTextFile(file)) continue;
    if (!bundledSources.has(file.path)) bundledSources.set(file.path, new Set());
    bundledSources.get(file.path).add(file.data);
  }

  const removed = new Set();
  const files = (snapshot.files ?? []).filter(file => {
    const remove = !targetPaths.has(file.path) && isTextFile(file) &&
      bundledSources.get(file.path)?.has(file.data);
    if (remove) removed.add(file.path);
    return !remove;
  }).map(file => file.path === '/index.js' && isTextFile(file) &&
    targetSource !== undefined && recognizedSources.has(file.data)
    ? {...file, data: targetSource}
    : {...file});

  // Snapshot directories include implicit parents and explicit empty folders.
  // Only parents of examples actually removed have evidence of being bundled.
  const bundledParents = new Set([...removed].flatMap(parents));
  const directories = new Set(snapshot.directories ?? []);
  for (const path of [...directories].sort((a, b) => b.length - a.length)) {
    if (!bundledParents.has(path)) continue;
    const prefix = path + '/';
    if (!files.some(file => file.path.startsWith(prefix)) &&
        ![...directories].some(child => child !== path && child.startsWith(prefix))) {
      directories.delete(path);
    }
  }

  const filePaths = new Set(files.map(file => file.path));
  const occupiedDirectories = new Set(directories);
  for (const file of files) for (const path of parents(file.path)) occupiedDirectories.add(path);
  function addMissing(file) {
    if (filePaths.has(file.path) || occupiedDirectories.has(file.path) ||
        parents(file.path).some(path => filePaths.has(path))) return;
    files.push({...file});
    filePaths.add(file.path);
    for (const path of parents(file.path)) {
      directories.add(path);
      occupiedDirectories.add(path);
    }
  }
  if (targetSource !== undefined) addMissing({path: '/index.js', data: targetSource});
  for (const file of targetExampleFiles) addMissing(file);

  return {
    ...snapshot,
    modeId: targetModeId,
    files,
    directories: [...directories],
    ...(removed.has(snapshot.activePath) ? {activePath: '/index.js'} : {}),
    ...(removed.has(snapshot.runPath) ? {runPath: '/index.js'} : {}),
  };
}
