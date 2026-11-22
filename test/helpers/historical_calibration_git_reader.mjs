import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const gitShow = (commit, path) => execFileSync('git', ['show', commit + ':' + path], {
  cwd: root, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});

/** Read immutable repository inputs for a historical calibration proof. */
export function createHistoricalGitReader(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw Error('Historical input requires an exact Git commit');
  const cache = new Map();

  return (location, options) => {
    const filename = location instanceof URL ? fileURLToPath(location) : resolve(String(location));
    const path = relative(root, filename).replaceAll('\\', '/');
    if (!path || path === '..' || path.startsWith('../')) throw Error('Historical input must be inside repository');
    if (!cache.has(path)) {
      let bytes;
      try {
        bytes = gitShow(commit, path);
      } catch (error) {
        const missingPath = error.status === 128 &&
          error.stderr?.toString().includes("path '" + path + "'");
        if (!missingPath || !/^docs\/issues\/[\w.-]+\.json$/.test(path)) throw error;
        // Current guards can consult newer, independently pinned receipts
        // while walking the chain. All source bytes still come from the cut.
        bytes = readFileSync(filename);
      }
      cache.set(path, bytes);
    }
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding ? cache.get(path).toString(encoding) : Buffer.from(cache.get(path));
  };
}
