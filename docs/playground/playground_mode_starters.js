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

/** Reconcile examples while keeping code unless the user explicitly chooses a starter.
 * Existing text, binary assets, checkpoints and project metadata remain user data.
 * `defaults` maps each mode ID to its current source, or to an array containing
 * that source followed by older bundled starters. `legacyDefaults` recognizes
 * old projects that have no recorded source mode. `codeChoice: 'keep'` is also
 * the restore policy. Explicit `initial` selects /index.js and backs up custom
 * index content before replacing it with the target mode's current starter.
 */
export function reconcileModeProject(snapshot, {
  sourceModeId = snapshot.modeId,
  targetModeId,
  codeChoice = 'keep',
  defaults = {},
  legacyDefaults = [],
  allExampleFiles = [],
  targetExampleFiles = [],
} = {}) {
  const defaultEntries = defaults instanceof Map ? [...defaults] : Object.entries(defaults);
  const defaultMap = new Map(defaultEntries);
  const targetSource = sources(defaultMap.get(targetModeId))[0];
  if (!['keep','initial'].includes(codeChoice)) throw new Error(`Unsupported mode code choice: ${codeChoice}`);
  if (targetSource === undefined) throw new Error(`Missing starter source for mode: ${targetModeId}`);
  const sourceKnown = defaultMap.has(sourceModeId);
  const recognizedSources = new Set(sourceKnown
    ? sources(defaultMap.get(sourceModeId))
    : [...defaultEntries.flatMap(([, value]) => sources(value)), ...sources(legacyDefaults)]);
  const targetPaths = new Set(targetExampleFiles.map(file => file.path));
  const protectedPaths = new Set(codeChoice === 'keep' ? [snapshot.activePath,snapshot.runPath] : []);
  const bundledSources = new Map();
  for (const file of allExampleFiles) {
    if (!isTextFile(file)) continue;
    if (!bundledSources.has(file.path)) bundledSources.set(file.path, new Set());
    bundledSources.get(file.path).add(file.data);
  }

  const removed = new Set();
  const files = (snapshot.files ?? []).filter(file => {
    const remove = file.path !== '/index.js' && !protectedPaths.has(file.path) && !targetPaths.has(file.path) && isTextFile(file) &&
      bundledSources.get(file.path)?.has(file.data);
    if (remove) removed.add(file.path);
    return !remove;
  }).map(file => ({...file}));

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
  if (codeChoice === 'initial') {
    if (occupiedDirectories.has('/index.js')) throw new Error('Cannot open mode starter: /index.js is a directory');
    const index = files.findIndex(file => file.path === '/index.js');
    if (index >= 0) {
      const previous = files[index];
      if (!isTextFile(previous) || !recognizedSources.has(previous.data)) {
        const sourceName = String(sourceModeId ?? 'previous').replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'') || 'previous';
        const base = `/index-${sourceName}`;
        let backup = `${base}.js`, suffix = 2;
        while (filePaths.has(backup) || occupiedDirectories.has(backup)) backup = `${base}-${suffix++}.js`;
        addMissing({...previous,path:backup});
      }
      files[index] = {path:'/index.js',type:'text',data:targetSource};
    } else addMissing({path:'/index.js',type:'text',data:targetSource});
  } else addMissing({path:'/index.js',data:targetSource});
  for (const file of targetExampleFiles) addMissing(file);

  return {
    ...snapshot,
    modeId: targetModeId,
    files,
    directories: [...directories],
    ...(codeChoice === 'initial' ? {activePath:'/index.js',runPath:'/index.js'} : {}),
  };
}
