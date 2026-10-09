import {createVirtualFileSystem, normalizeVirtualPath, transferVirtualFiles as transfer} from '../js/tetorica_virtual_files/index.js';
export {createVirtualFileSystem, normalizeVirtualPath, createVirtualFileReader} from '../js/tetorica_virtual_files/index.js';

// Entry-point and built-in-file policies belong to Playground, not the generic filesystem.
export function transferVirtualFiles(fs, source, destination, options = {}) {
  source = normalizeVirtualPath(source); destination = normalizeVirtualPath(destination);
  if ([source,destination].some(path => path === '/sys' || path.startsWith('/sys/'))) throw Error('/sys is reserved for built-in files.');
  if (!options.copy && source === '/index.js' && source !== destination) throw Error('/index.js cannot be moved.');
  return transfer(fs, source, destination, options);
}

export function resolveVirtualDynamicImports(
  fileSystem,
  source,
  currentPath,
  createModuleUrl
) {
  const resolving = new Set();

  function createUrl(path) {
    const normalizedPath = normalizeVirtualPath(path);
    if (resolving.has(normalizedPath)) {
      throw new Error(`Circular virtual module import: ${normalizedPath}`);
    }
    const file = fileSystem.get(normalizedPath);
    if (!file || file.type !== "text") {
      throw new Error(`Virtual JavaScript module not found: ${normalizedPath}`);
    }

    resolving.add(normalizedPath);
    const resolvedSource = replaceImports(file.data, normalizedPath);
    resolving.delete(normalizedPath);
    return createModuleUrl(resolvedSource, normalizedPath);
  }

  function replaceImports(moduleSource, modulePath) {
    return moduleSource.replace(
      /\bimport\s*\(\s*(["'])(\.[^"']*)\1\s*\)/g,
      (_match, _quote, relativePath) =>
        `import(${JSON.stringify(createUrl(normalizeVirtualPath(relativePath, modulePath)))})`
    );
  }

  return replaceImports(source, currentPath);
}

export function createVirtualFileRuntimeSource(
  fileSystem,
  currentPath,
  options = {}
) {
  const files = {};

  for (const entry of fileSystem.list()) {
    files[entry.path] = {
      type: entry.type,
      data: entry.type === "text"
        ? entry.data
        : encodeBase64(entry.data),
    };
  }

  const storeSource = options.install
    ? `globalThis.__tetoricaVirtualFiles = ${JSON.stringify(files)};`
    : "";
  const sampleFileSource = options.install
    ? `
if (typeof sample !== "undefined") {
  const loadSample = sample.load.bind(sample);
  sample.load = async (name, source) => {
    if (
      typeof source === "string" &&
      globalThis.__tetoricaVirtualFiles?.[source]
    ) {
      return loadSample(
        name,
        await file(source, { type: "arrayBuffer" })
      );
    }
    if (
      source === undefined &&
      typeof name === "string" &&
      globalThis.__tetoricaVirtualFiles?.[name]
    ) {
      return loadSample(
        name,
        await file(name, { type: "arrayBuffer" })
      );
    }
    return loadSample(name, source);
  };
  sample.loadFile = (path) => sample.load(path);
}`
    : "";
  const currentPathSource = JSON.stringify(currentPath);

  return `
${storeSource}
const file = async (path, options = {}) => {
  const input = String(path ?? "");
  const parts = input.startsWith("/")
    ? []
    : ${currentPathSource}.split("/").slice(0, -1).filter(Boolean);
  for (const part of input.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) throw new Error("Virtual file path escapes the project: " + input);
      parts.pop();
      continue;
    }
    if (part.includes("\\\\")) throw new Error("Virtual file path contains a backslash: " + input);
    parts.push(part);
  }
  const resolvedPath = "/" + parts.join("/");
  const entry = globalThis.__tetoricaVirtualFiles?.[resolvedPath];
  if (!entry) throw new Error("Virtual file not found: " + resolvedPath);
  const type = options.type ?? "text";
  const bytes = entry.type === "text"
    ? new TextEncoder().encode(entry.data)
    : Uint8Array.from(atob(entry.data), (char) => char.charCodeAt(0));
  if (type === "text") return entry.type === "text" ? entry.data : new TextDecoder().decode(bytes);
  if (type === "arrayBuffer") return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  if (type === "json") return JSON.parse(entry.type === "text" ? entry.data : new TextDecoder().decode(bytes));
  throw new Error("Unsupported virtual file type: " + type);
};
${options.install ? 'if (typeof midi !== "undefined") midi.setFileReader(file);' : ''}
${sampleFileSource}`;
}

function encodeBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary);
}
