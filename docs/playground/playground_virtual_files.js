const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function normalizeVirtualPath(path, basePath = "/") {
  const input = String(path ?? "");
  const base = String(basePath ?? "/");
  const parts = input.startsWith("/")
    ? []
    : base.split("/").slice(0, -1).filter(Boolean);

  for (const part of input.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      if (parts.length === 0) {
        throw new Error(`Virtual file path escapes the project: ${input}`);
      }
      parts.pop();
      continue;
    }
    if (part.includes("\\")) {
      throw new Error(`Virtual file path contains a backslash: ${input}`);
    }
    parts.push(part);
  }

  if (parts.length === 0) {
    throw new Error(`Virtual file path is empty: ${input}`);
  }

  return `/${parts.join("/")}`;
}

export function createVirtualFileSystem(entries = []) {
  const files = new Map();

  for (const entry of entries) {
    writeVirtualFile(files, entry.path, entry.data);
  }

  return {
    has(path) {
      return files.has(normalizeVirtualPath(path));
    },
    get(path) {
      return files.get(normalizeVirtualPath(path)) ?? null;
    },
    list() {
      return Array.from(files.values(), (file) => ({
        ...file,
        data: copyFileData(file.data),
      }));
    },
    replace(entries) {
      files.clear();
      for (const entry of entries) {
        writeVirtualFile(files, entry.path, entry.data);
      }
    },
    writeText(path, text) {
      writeVirtualFile(files, path, String(text));
    },
    writeBinary(path, bytes) {
      writeVirtualFile(files, path, bytes);
    },
    delete(path) {
      return files.delete(normalizeVirtualPath(path));
    },
    createFileReader(currentPath = "/index.js") {
      return createVirtualFileReader(this, currentPath);
    },
  };
}

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
${sampleFileSource}`;
}

function writeVirtualFile(files, path, data) {
  const normalizedPath = normalizeVirtualPath(path);
  if (typeof data === "string") {
    files.set(normalizedPath, {
      path: normalizedPath,
      type: "text",
      data,
    });
    return;
  }

  const bytes = toUint8Array(data);
  files.set(normalizedPath, {
    path: normalizedPath,
    type: "binary",
    data: new Uint8Array(bytes),
  });
}

function copyFileData(data) {
  return typeof data === "string"
    ? data
    : new Uint8Array(data);
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  throw new TypeError("Virtual file data must be text or binary bytes.");
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
