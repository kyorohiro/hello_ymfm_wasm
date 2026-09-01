import {
  strToU8,
  zipSync,
} from "./vendor/fflate.js";

const MAX_CASSETTE_BYTES = 16 * 1024 * 1024;
const MAX_SHARE_URL_LENGTH = 8000;
const MAX_SHARE_ZIP_BYTES = 5000;

const CATEGORY_CONFIG = {
  timbres: {
    inputId: "timbreFiles",
    listId: "timbreList",
    extensions: new Set([".tfi"]),
    compress: true,
  },
  examples: {
    inputId: "exampleFiles",
    listId: "exampleList",
    extensions: new Set([".js"]),
    compress: true,
  },
  samples: {
    inputId: "sampleFiles",
    listId: "sampleList",
    extensions: new Set([
      ".wav",
      ".flac",
      ".mp3",
      ".ogg",
      ".m4a",
    ]),
    compress: false,
  },
};

const selectedFiles = new Map(
  Object.keys(CATEGORY_CONFIG).map(
    (category) => [category, []]
  )
);

let generatedCassette = null;

export async function createCassetteZip(
  options
) {
  const name = normalizeCassetteName(
    options.name
  );
  const files = {};

  for (const [category, config] of Object.entries(
    CATEGORY_CONFIG
  )) {
    const categoryFiles =
      options[category] ?? [];
    const names = new Set();

    for (const file of categoryFiles) {
      const fileName = validateFileName(
        file.name,
        category,
        config.extensions
      );

      if (names.has(fileName)) {
        throw new Error(
          `Duplicate ${category} file "${fileName}".`
        );
      }
      names.add(fileName);

      const bytes = new Uint8Array(
        await file.arrayBuffer()
      );
      files[`${category}/${fileName}`] =
        config.compress
          ? bytes
          : [bytes, { level: 0 }];
    }
  }

  const readme = String(options.readme ?? "")
    .trim();
  if (readme) {
    files["README.md"] = strToU8(readme);
  }

  if (Object.keys(files).length === 0) {
    throw new Error(
      "Add at least one timbre, example, or sample."
    );
  }

  const zip = zipSync(files, { level: 6 });
  if (zip.byteLength > MAX_CASSETTE_BYTES) {
    throw new Error(
      "Cassette exceeds the 16 MiB loader limit. Remove files before exporting."
    );
  }

  return {
    name,
    zip,
  };
}

function normalizeCassetteName(value) {
  const name = String(value ?? "")
    .trim();

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(
      "Cassette name must use letters, numbers, hyphens, or underscores."
    );
  }

  return name;
}

function validateFileName(
  value,
  category,
  extensions
) {
  const name = String(value ?? "");
  const extensionIndex = name.lastIndexOf(".");
  const extension = extensionIndex < 0
    ? ""
    : name.slice(extensionIndex).toLowerCase();

  if (
    !name ||
    name.includes("/") ||
    name.includes("\\") ||
    !extensions.has(extension)
  ) {
    throw new Error(
      `"${name}" is not a supported ${category} file.`
    );
  }

  return name;
}

function base64UrlEncode(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (
    let offset = 0;
    offset < bytes.length;
    offset += chunkSize
  ) {
    binary += String.fromCharCode(
      ...bytes.subarray(
        offset,
        offset + chunkSize
      )
    );
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function renderFileList(category) {
  const config = CATEGORY_CONFIG[category];
  const list = document.getElementById(
    config.listId
  );
  const files = selectedFiles.get(category);

  list.replaceChildren();
  for (const file of files) {
    const item = document.createElement("li");
    item.textContent = `${file.name} (${formatBytes(file.size)})`;
    list.appendChild(item);
  }
}

function updateSelection(category, fileList) {
  selectedFiles.set(
    category,
    Array.from(fileList ?? [])
  );
  renderFileList(category);
  generatedCassette = null;
  setShareButtonEnabled(false);
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function setStatus(message, tone = "") {
  const status = document.getElementById(
    "generatorStatus"
  );
  status.textContent = message;
  status.dataset.tone = tone;
}

function setShareButtonEnabled(enabled) {
  document.getElementById(
    "copyShareLinkButton"
  ).disabled = !enabled;
}

async function generateAndDownload() {
  try {
    const result = await createCassetteZip({
      name: document.getElementById(
        "cassetteName"
      ).value,
      timbres: selectedFiles.get("timbres"),
      examples: selectedFiles.get("examples"),
      samples: selectedFiles.get("samples"),
      readme: document.getElementById(
        "readmeText"
      ).value,
    });
    generatedCassette = result;

    const blob = new Blob([result.zip], {
      type: "application/zip",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${result.name}.cassette.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    let canShare = false;
    if (result.zip.byteLength <= MAX_SHARE_ZIP_BYTES) {
      const encoded = base64UrlEncode(result.zip);
      const shareUrl = new URL(
        "./index.html",
        window.location.href
      );
      shareUrl.searchParams.set("cassette", encoded);
      if (shareUrl.href.length <= MAX_SHARE_URL_LENGTH) {
        result.shareUrl = shareUrl.href;
        canShare = true;
      }
    }
    setShareButtonEnabled(canShare);
    setStatus(
      canShare
        ? `Downloaded ${link.download}. Share URL is ready.`
        : `Downloaded ${link.download}. It is too large for a practical share URL.`,
      "success"
    );
  } catch (error) {
    generatedCassette = null;
    setShareButtonEnabled(false);
    setStatus(error.message, "error");
  }
}

async function copyShareUrl() {
  if (!generatedCassette) {
    return;
  }

  if (!generatedCassette.shareUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(
      generatedCassette.shareUrl
    );
    setStatus("Share URL copied.", "success");
  } catch (error) {
    setStatus(
      "Could not copy the share URL. Use a secure browser context.",
      "error"
    );
  }
}

if (typeof document !== "undefined") {
  for (const [category, config] of Object.entries(
    CATEGORY_CONFIG
  )) {
    document.getElementById(config.inputId)
      .addEventListener("change", (event) => {
        updateSelection(
          category,
          event.currentTarget.files
        );
      });
    renderFileList(category);
  }

  document.getElementById("buildCassetteButton")
    .addEventListener("click", () => {
      void generateAndDownload();
    });
  document.getElementById("copyShareLinkButton")
    .addEventListener("click", () => {
      void copyShareUrl();
    });
}
