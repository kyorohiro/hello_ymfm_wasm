const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_STORED = 0;
const ZIP_DEFLATE = 8;
const MAX_CASSETTE_BYTES = 16 * 1024 * 1024;

const CASSETTE_DIRECTORIES = {
  timbres: new Set([".tfi"]),
  examples: new Set([".js"]),
  samples: new Set([
    ".wav",
    ".flac",
    ".mp3",
    ".ogg",
    ".m4a",
  ]),
};

export async function loadPlaygroundCassette(
  source,
  options = {}
) {
  const bytes = toUint8Array(source);

  if (bytes.byteLength > MAX_CASSETTE_BYTES) {
    throw new Error(
      "Cassette is larger than the 16 MiB limit."
    );
  }

  const zipEntries = await readZipEntries(
    bytes
  );
  const cassette = {
    id: createCassetteId(
      options.name
    ),
    timbres: [],
    examples: [],
    samples: [],
  };
  const namesByCategory = new Map();

  for (const entry of zipEntries) {
    const descriptor = describeCassettePath(
      entry.path
    );

    if (!descriptor) {
      continue;
    }

    let names = namesByCategory.get(
      descriptor.category
    );
    if (!names) {
      names = new Set();
      namesByCategory.set(
        descriptor.category,
        names
      );
    }

    if (names.has(descriptor.name)) {
      throw new Error(
        `Duplicate cassette ${descriptor.category} name "${descriptor.name}".`
      );
    }
    names.add(descriptor.name);

    const bytes = await entry.read();
    const item = {
      name: descriptor.name,
      path: entry.path,
      bytes,
    };

    if (descriptor.category === "examples") {
      item.source = new TextDecoder().decode(
        bytes
      );
    }

    cassette[descriptor.category].push(item);
  }

  return cassette;
}

function createCassetteId(name) {
  const baseName = String(name ?? "cassette")
    .split(/[\\/]/)
    .pop() || "cassette";
  const withoutExtension = baseName.replace(
    /\.cassette\.zip$/i,
    ""
  ).replace(/\.zip$/i, "");

  return withoutExtension || "cassette";
}

function describeCassettePath(path) {
  const parts = path.split("/");

  if (parts.length !== 2) {
    return null;
  }

  const [category, fileName] = parts;
  const extensions = CASSETTE_DIRECTORIES[category];

  if (!extensions) {
    return null;
  }

  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex < 0
    ? ""
    : fileName.slice(extensionIndex).toLowerCase();

  if (!extensions.has(extension)) {
    return null;
  }

  const name = fileName.slice(0, extensionIndex);
  if (!name) {
    throw new Error(
      `Cassette file "${path}" has no public name.`
    );
  }

  return {
    category,
    name,
  };
}

async function readZipEntries(bytes) {
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );
  const endOffset = findEndOfCentralDirectory(
    view
  );
  const entryCount = view.getUint16(
    endOffset + 10,
    true
  );
  const centralDirectorySize = view.getUint32(
    endOffset + 12,
    true
  );
  const centralDirectoryOffset = view.getUint32(
    endOffset + 16,
    true
  );

  if (
    centralDirectoryOffset +
      centralDirectorySize >
    bytes.byteLength
  ) {
    throw new Error(
      "Cassette zip has an invalid central directory."
    );
  }

  const entries = [];
  let offset = centralDirectoryOffset;
  let totalUncompressedSize = 0;

  for (let index = 0; index < entryCount; index += 1) {
    requireSignature(
      view,
      offset,
      ZIP_CENTRAL_DIRECTORY_HEADER,
      "central directory"
    );

    const flags = view.getUint16(
      offset + 8,
      true
    );
    const compression = view.getUint16(
      offset + 10,
      true
    );
    const compressedSize = view.getUint32(
      offset + 20,
      true
    );
    const uncompressedSize = view.getUint32(
      offset + 24,
      true
    );
    const fileNameLength = view.getUint16(
      offset + 28,
      true
    );
    const extraLength = view.getUint16(
      offset + 30,
      true
    );
    const commentLength = view.getUint16(
      offset + 32,
      true
    );
    const localHeaderOffset = view.getUint32(
      offset + 42,
      true
    );
    const entryEnd = offset + 46 + fileNameLength +
      extraLength + commentLength;

    if (entryEnd > bytes.byteLength) {
      throw new Error(
        "Cassette zip contains a truncated entry."
      );
    }

    if ((flags & 0x1) !== 0) {
      throw new Error(
        "Encrypted cassette zip entries are not supported."
      );
    }

    if (
      compression !== ZIP_STORED &&
      compression !== ZIP_DEFLATE
    ) {
      throw new Error(
        `Cassette zip uses unsupported compression method ${compression}.`
      );
    }

    if (uncompressedSize > MAX_CASSETTE_BYTES) {
      throw new Error(
        "Cassette zip entry exceeds the 16 MiB limit."
      );
    }
    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > MAX_CASSETTE_BYTES) {
      throw new Error(
        "Cassette zip exceeds the 16 MiB expanded size limit."
      );
    }

    const path = decodeZipPath(
      bytes.subarray(
        offset + 46,
        offset + 46 + fileNameLength
      )
    );
    validateZipPath(path);

    if (!path.endsWith("/")) {
      entries.push({
        path,
        read: () => readZipEntryData({
          bytes,
          view,
          localHeaderOffset,
          compressedSize,
          uncompressedSize,
          compression,
        }),
      });
    }

    offset = entryEnd;
  }

  return entries;
}

function findEndOfCentralDirectory(view) {
  const minimumSize = 22;
  const firstOffset = Math.max(
    0,
    view.byteLength - minimumSize - 0xffff
  );

  for (
    let offset = view.byteLength - minimumSize;
    offset >= firstOffset;
    offset -= 1
  ) {
    if (
      view.getUint32(offset, true) ===
      ZIP_END_OF_CENTRAL_DIRECTORY
    ) {
      return offset;
    }
  }

  throw new Error(
    "Cassette is not a supported zip archive."
  );
}

async function readZipEntryData(entry) {
  const {
    bytes,
    view,
    localHeaderOffset,
    compressedSize,
    uncompressedSize,
    compression,
  } = entry;

  requireSignature(
    view,
    localHeaderOffset,
    ZIP_LOCAL_FILE_HEADER,
    "local file header"
  );

  const fileNameLength = view.getUint16(
    localHeaderOffset + 26,
    true
  );
  const extraLength = view.getUint16(
    localHeaderOffset + 28,
    true
  );
  const dataOffset = localHeaderOffset + 30 +
    fileNameLength + extraLength;
  const dataEnd = dataOffset + compressedSize;

  if (dataEnd > bytes.byteLength) {
    throw new Error(
      "Cassette zip contains truncated file data."
    );
  }

  const compressed = bytes.slice(
    dataOffset,
    dataEnd
  );
  const result = compression === ZIP_STORED
    ? compressed
    : await inflateRaw(compressed);

  if (result.byteLength !== uncompressedSize) {
    throw new Error(
      "Cassette zip entry has an unexpected uncompressed size."
    );
  }

  return result;
}

async function inflateRaw(compressed) {
  if (typeof DecompressionStream !== "function") {
    throw new Error(
      "Cassette zip requires browser deflate support."
    );
  }

  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(
      new DecompressionStream("deflate-raw")
    );
  const buffer = await new Response(stream)
    .arrayBuffer();

  return new Uint8Array(buffer);
}

function decodeZipPath(bytes) {
  return new TextDecoder().decode(bytes);
}

function validateZipPath(path) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some(
      (part) =>
        part === "" ||
        part === "." ||
        part === ".."
    )
  ) {
    throw new Error(
      `Cassette zip contains unsafe path "${path}".`
    );
  }
}

function requireSignature(
  view,
  offset,
  signature,
  label
) {
  if (
    offset < 0 ||
    offset + 4 > view.byteLength ||
    view.getUint32(offset, true) !== signature
  ) {
    throw new Error(
      `Cassette zip has an invalid ${label}.`
    );
  }
}

function toUint8Array(source) {
  if (source instanceof Uint8Array) {
    return source;
  }

  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }

  throw new TypeError(
    "Cassette source must be an ArrayBuffer or Uint8Array."
  );
}
