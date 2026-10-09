import {normalizeVirtualPath} from './path.js';
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

/** @typedef {{(path:string,options?:{type?:'text'}):Promise<string>; (path:string,options:{type:'arrayBuffer'}):Promise<ArrayBuffer>; (path:string,options:{type:'json'}):Promise<unknown>}} VirtualFileReader */
/** @param {{get(path:string):import('./filesystem.js').VirtualFile|null}} fileSystem
 * @param {string} currentPath @returns {VirtualFileReader} */
export function createVirtualFileReader(fileSystem, currentPath) {
  return async function file(path, options = {}) {
    const resolvedPath = normalizeVirtualPath(path, currentPath);
    const entry = fileSystem.get(resolvedPath);
    if (!entry) {
      throw new Error(`Virtual file not found: ${resolvedPath}`);
    }

    const type = options.type ?? "text";
    if (type === "text") {
      return entry.type === "text"
        ? entry.data
        : textDecoder.decode(entry.data);
    }
    if (type === "arrayBuffer") {
      const bytes = entry.type === "text"
        ? textEncoder.encode(entry.data)
        : entry.data;
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );
    }
    if (type === "json") {
      return JSON.parse(await file(path, { type: "text" }));
    }

    throw new Error(`Unsupported virtual file type: ${type}`);
  };
}
