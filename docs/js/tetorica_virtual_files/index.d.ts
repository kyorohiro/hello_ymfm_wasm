export { createVirtualFileSystem, transferVirtualFiles, CHECKPOINT_ROOT, isCheckpointPath } from './filesystem.js';
export { normalizeVirtualPath, resolvePath, dirname } from './path.js';
export { createVirtualFileReader } from './reader.js';
export { createShell, parseCommand } from './shell.js';
export { applyTextPatch, diffSnapshots, undoFileChanges } from './patch.js';
export { parsePipeline } from './pipeline.js';
