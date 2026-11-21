// SPDX-License-Identifier: BSD-3-Clause
import { dirname } from '../js/tetorica_virtual_files/path.js';
import { assembleTwoSf, isTwoSfPath, isTwoSfSourcePath } from './2sf_source.js';
import { NDS_PROJECT_FILE_BYTES, ndsProjectPath } from './nds-project.js';

const SONG_DIRECTORY = '/2sf';
const MAX_ROM_BYTES = 64 * 1024 * 1024; // The 2SF playback engine's limit.
const isBelow = (path, root) => path.startsWith(root + '/');
const sortPaths = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** Scan saved directory entries without copying any sound or library data. */
export function listSavedTwoSfSets(savedFs) {
	const directories = new Set(savedFs.listDirectories().filter(path => isBelow(path, SONG_DIRECTORY)));
	const groups = new Map();
	for (const directory of directories) {
		const name = directory.split('/')[2];
		const root = `${SONG_DIRECTORY}/${name}`;
		const group = groups.get(root) ?? { root, name, paths: [], tracks: [] };
		groups.set(root, group);
		for (const filename of savedFs.readdir(directory)) {
			const path = `${directory}/${filename}`;
			if (!isTwoSfSourcePath(path) || directories.has(path)) continue;
			group.paths.push(path);
			if (isTwoSfPath(path)) group.tracks.push(path);
		}
	}
	return [...groups.values()].filter(group => group.tracks.length).map(group => {
		group.paths.sort(sortPaths);
		group.tracks.sort(sortPaths);
		group.revision = group.paths.map(path => savedFs.getRevision(path)).join(',');
		return group;
	}).sort((a, b) => sortPaths(a.name, b.name));
}

function occupiedPaths(fs) {
	const paths = new Map();
	for (const directory of fs.listDirectories()) {
		if (directory !== SONG_DIRECTORY && !isBelow(directory, SONG_DIRECTORY)) continue;
		paths.set(directory, 'directory');
		for (const child of fs.readdir(directory)) {
			const path = `${directory}/${child}`;
			paths.set(path, fs.has(path) ? 'file' : 'directory');
		}
	}
	return paths;
}

function equalBytes(fs, path, bytes) {
	if (fs.stat(path).size !== bytes.length) return false;
	const file = fs.get(path);
	if (file.type !== 'binary') return false;
	for (let index = 0; index < bytes.length; index++) if (file.data[index] !== bytes[index]) return false;
	return true;
}

function choosePaths(project, label, originals, dirtyPaths) {
	const working = occupiedPaths(project.fs), saved = occupiedPaths(project.savedFs);
	const allPaths = new Set([...working.keys(), ...saved.keys()]);
	const folded = new Map();
	for (const path of allPaths) {
		const key = path.toLowerCase();
		if (!folded.has(key)) folded.set(key, []);
		folded.get(key).push(path);
	}
	const setPath = `${SONG_DIRECTORY}/${label}`;
	const candidates = [...allPaths].filter(path => dirname(path) === SONG_DIRECTORY &&
		(path === setPath || path.startsWith(setPath) && /^ \([1-9]\d*\)$/.test(path.slice(setPath.length)))).sort(sortPaths);
	for (let suffix = 1; ; suffix++) {
		const unused = suffix === 1 ? setPath : `${setPath} (${suffix})`;
		if (folded.has(unused.toLowerCase())) continue;
		candidates.push(unused);
		break;
	}
	let best;
	for (const root of candidates) {
		const mapped = originals.map(({ path, data }) => ({ path: ndsProjectPath(`${root}/${path}`), type: 'binary', data }));
		const planned = new Set();
		for (const { path } of mapped) {
			for (let part = path; !planned.has(part) && part !== SONG_DIRECTORY; part = dirname(part)) planned.add(part);
		}
		// An extra case variant can shadow a library that the original loader
		// found by case-folded lookup, even if every planned file already exists.
		if ([...planned].some(path => folded.get(path.toLowerCase())?.some(variant =>
			!allPaths.has(path) || !planned.has(variant)))) continue;
		const additions = mapped.filter(file => !saved.has(file.path));
		const bytes = additions.reduce((total, { data }) => total + data.byteLength, 0);
		if (best && bytes >= best.bytes) continue;
		const compatible = mapped.every(({ path, data }) => {
			const existing = working.get(path);
			if (existing !== saved.get(path) || existing === 'directory') return false;
			if (existing === 'file' && (dirtyPaths.has(path) || !equalBytes(project.savedFs, path, data))) return false;
			for (let parent = dirname(path); parent !== SONG_DIRECTORY; parent = dirname(parent)) {
				const kind = working.get(parent);
				if (kind === 'file' || kind !== saved.get(parent)) return false;
			}
			return true;
		});
		if (compatible) best = { root, mapped, additions, bytes };
	}
	return best;
}

function checkCassetteBudget(project, additions, dirtyPaths) {
	let size = additions.reduce((total, { data }) => total + data.byteLength, 0);
	for (const directory of project.savedFs.listDirectories()) {
		for (const child of project.savedFs.readdir(directory)) {
			const path = `${directory === '/' ? '' : directory}/${child}`;
			if (project.savedFs.has(path)) size += project.savedFs.stat(path).size;
		}
	}
	// An unsaved replacement occupies an additional Cassette entry.
	for (const path of dirtyPaths) if (project.fs.has(path)) size += project.fs.stat(path).size;
	if (size > NDS_PROJECT_FILE_BYTES) throw new Error('This 2SF song and the current project exceed the Cassette size limit.');
}

/** Save the selected song and its resolved dependencies as original binaries. */
export async function saveTwoSfSong(project, song, entries, { isCurrent = () => true } = {}) {
	const controller = new AbortController();
	const checkCurrent = () => {
		if (!isCurrent()) controller.abort(new DOMException('Saving the 2SF song was cancelled.', 'AbortError'));
		controller.signal.throwIfAborted();
	};
	checkCurrent();
	if (project.fs.has(SONG_DIRECTORY) || project.savedFs.has(SONG_DIRECTORY))
		throw new Error('A file named /2sf blocks saving songs to the 2SF folder.');
	const loaded = new Map();
	let bytes = 0;
	const sources = entries.map(({ path, file }) => ({ path, size: file.size, async arrayBuffer() {
		checkCurrent();
		if (bytes + file.size > NDS_PROJECT_FILE_BYTES) throw new Error('This 2SF song and its libraries exceed the Cassette size limit.');
		const data = new Uint8Array(await file.arrayBuffer());
		checkCurrent();
		bytes += data.byteLength;
		loaded.set(path, data);
		return data;
	} }));
	const { files } = await assembleTwoSf(song, sources, { maxRomBytes: MAX_ROM_BYTES, signal: controller.signal });
	checkCurrent();
	const paths = [...new Set([song, ...files])];
	const originals = paths.map(path => ({ path: path.replaceAll('\\', '/'), data: loaded.get(path) }));
	const parts = sources.map(({ path }) => path.replaceAll('\\', '/').split('/').filter(Boolean));
	const folder = parts[0]?.[0];
	const hasFolder = parts.every(path => path.length > 1 && path[0] === folder);
	const label = hasFolder && folder.length <= 100 && !['.', '..', '.git', '.tet.ss'].includes(folder) ? folder : 'Imported 2SF';
	const dirtyPaths = new Set(project.getDirtyPaths());
	const { root, mapped, additions } = choosePaths(project, label, originals, dirtyPaths);
	if (additions.length) {
		checkCassetteBudget(project, additions, dirtyPaths);
		project.importFiles(additions, { save: true });
	}
	return { root, path: mapped[0].path, added: additions.length };
}
