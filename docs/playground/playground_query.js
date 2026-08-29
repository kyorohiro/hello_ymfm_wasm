import { parseTfi, TFI_FILE_SIZE } from "../js/tfi.js";

const SIMPLE_TFI_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function decodeBase64Bytes(encodedValue) {
  if (!encodedValue) {
    return null;
  }

  try {
    const normalized = String(encodedValue)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padding =
      normalized.length % 4 === 0
        ? ""
        : "=".repeat(
            4 -
              (normalized.length %
                4)
          );
    const padded =
      normalized + padding;

    if (
      !/^[A-Za-z0-9+/]*={0,2}$/.test(
        padded
      )
    ) {
      return null;
    }

    if (typeof atob === "function") {
      const binary = atob(padded);
      return Uint8Array.from(
        binary,
        (char) =>
          char.charCodeAt(0)
      );
    }

    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(
        Buffer.from(
          padded,
          "base64"
        )
      );
    }

    return null;
  } catch (error) {
    console.warn(error);
    return null;
  }
}

export function decodeBase64Source(
  encodedSource
) {
  const bytes =
    decodeBase64Bytes(
      encodedSource
    );

  if (!bytes) {
    return null;
  }

  try {
    return new TextDecoder().decode(
      bytes
    );
  } catch (error) {
    console.warn(error);
    return null;
  }
}

export function resolveInitialSourceFromQuery(
  search,
  examples,
  defaultExampleName = "live-loop"
) {
  const params =
    new URLSearchParams(
      normalizeSearch(search)
    );
  const encodedSource =
    params.get("src");

  if (encodedSource) {
    const decodedSource =
      decodeBase64Source(
        encodedSource
      );

    if (decodedSource !== null) {
      return {
        source: decodedSource,
        exampleName: null,
        status:
          "Loaded code from ?src=...",
      };
    }

    return {
      source:
        examples[
          defaultExampleName
        ] ?? "",
      exampleName:
        defaultExampleName,
      status:
        "Failed to decode ?src=...",
    };
  }

  const exampleName =
    params.get("ex");

  if (
    exampleName &&
    examples[exampleName]
  ) {
    return {
      source: examples[exampleName],
      exampleName,
      status: `Loaded example from ?ex=${exampleName}`,
    };
  }

  return {
    source:
      examples[
        defaultExampleName
      ] ?? "",
    exampleName:
      defaultExampleName,
    status: null,
  };
}

export function loadTfiPresetsFromQuery(
  search
) {
  const params =
    new URLSearchParams(
      normalizeSearch(search)
    );
  const encodedTfiList =
    splitCommaValues(
      params.get("tfi")
    );
  const tfiIds =
    splitCommaValues(
      params.get("tfi-id")
    );

  const presets = {};
  const loadedIds = [];
  const errors = [];

  if (
    encodedTfiList.length === 0 &&
    tfiIds.length === 0
  ) {
    return {
      presets,
      loadedIds,
      errors,
    };
  }

  if (
    encodedTfiList.length === 0 ||
    tfiIds.length === 0
  ) {
    errors.push(
      "Both ?tfi= and ?tfi-id= are required to load URL TFI presets."
    );
    return {
      presets,
      loadedIds,
      errors,
    };
  }

  if (
    encodedTfiList.length !==
    tfiIds.length
  ) {
    errors.push(
      `Mismatched TFI parameter counts: tfi=${encodedTfiList.length}, tfi-id=${tfiIds.length}.`
    );
  }

  const pairCount = Math.min(
    encodedTfiList.length,
    tfiIds.length
  );

  for (
    let index = 0;
    index < pairCount;
    index += 1
  ) {
    const id = tfiIds[index];

    if (
      !SIMPLE_TFI_ID_PATTERN.test(
        id
      )
    ) {
      errors.push(
        `Ignored URL TFI preset with invalid id "${id}".`
      );
      continue;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        presets,
        id
      )
    ) {
      errors.push(
        `Ignored duplicate URL TFI preset id "${id}".`
      );
      continue;
    }

    const bytes =
      decodeBase64Bytes(
        encodedTfiList[index]
      );

    if (!bytes) {
      errors.push(
        `Failed to decode URL TFI preset "${id}".`
      );
      continue;
    }

    if (
      bytes.length !==
      TFI_FILE_SIZE
    ) {
      errors.push(
        `Ignored URL TFI preset "${id}" because it is ${bytes.length} bytes, expected ${TFI_FILE_SIZE}.`
      );
      continue;
    }

    try {
      presets[id] = parseTfi(
        bytes
      );
      loadedIds.push(id);
    } catch (error) {
      errors.push(
        `Failed to parse URL TFI preset "${id}": ${error.message}`
      );
    }
  }

  return {
    presets,
    loadedIds,
    errors,
  };
}

function splitCommaValues(
  value
) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeSearch(search) {
  return String(search ?? "");
}
