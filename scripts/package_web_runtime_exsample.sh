#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
RELEASE_DIR="${ROOT_DIR}/release"
VERSION="${1:-dev}"
STAGE_DIR="${RELEASE_DIR}/web_runtime_exsample_${VERSION}"
ZIP_PATH="${RELEASE_DIR}/hello_ymfm_wasm_${VERSION}_web_runtime_exsample.zip"

DOCS_DIR="${ROOT_DIR}/docs"
DOCS_DEMOS_DIR="${DOCS_DIR}/demos"
DOCS_INFO_DIR="${DOCS_DIR}/info"
PLAYGROUND_SAMPLES_DIR="${DOCS_DIR}/playground/samples"
LICENSE_FILE="${ROOT_DIR}/LICENSE"

DEMO_FILES="
beep.html
vgm.html
vgm_runtime.html
megasynth_embeded.html
playground_runtime.html
"

INFO_FILES="
ym2612synth_audioworklet.html
"

if [ ! -d "${PLAYGROUND_SAMPLES_DIR}" ]; then
  echo "error: missing directory: ${PLAYGROUND_SAMPLES_DIR}" >&2
  exit 1
fi

if [ ! -f "${LICENSE_FILE}" ]; then
  echo "error: missing file: ${LICENSE_FILE}" >&2
  exit 1
fi

mkdir -p "${RELEASE_DIR}"
rm -rf "${STAGE_DIR}"
rm -f "${ZIP_PATH}"
mkdir -p "${STAGE_DIR}/demos" "${STAGE_DIR}/info" "${STAGE_DIR}/js" "${STAGE_DIR}/generated" "${STAGE_DIR}/samples" "${STAGE_DIR}/licenses/nuked-opn2"

for file in ${DEMO_FILES}; do
  src="${DOCS_DEMOS_DIR}/${file}"
  dst="${STAGE_DIR}/demos/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing demo file: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
done

for file in ${INFO_FILES}; do
  src="${DOCS_INFO_DIR}/${file}"
  dst="${STAGE_DIR}/info/${file}"

  if [ ! -f "${src}" ]; then
    echo "error: missing info file: ${src}" >&2
    exit 1
  fi

  cp "${src}" "${dst}"
done

# The packaged reference page returns to the package's landing page.
perl -0pi -e 's#href="\./index\.html"#href="../index.html"#g' \
  "${STAGE_DIR}/info/ym2612synth_audioworklet.html"

cp -R "${PLAYGROUND_SAMPLES_DIR}/." "${STAGE_DIR}/samples/"
cp "${LICENSE_FILE}" "${STAGE_DIR}/LICENSE"

cat > "${STAGE_DIR}/index.html" <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>hello_ymfm_wasm exsample</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe4;
        --panel: #fffaf0;
        --ink: #1f1b16;
        --accent: #b4572f;
        --accent-dark: #7e381c;
        --line: #d7c8ac;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Avenir Next", "Helvetica Neue", Helvetica, Arial, sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, #fff8df 0, transparent 28%),
          radial-gradient(circle at bottom right, #f0d8ba 0, transparent 24%),
          linear-gradient(160deg, var(--bg), #eadfc9 60%, #e0cfb5);
      }

      main {
        max-width: 860px;
        margin: 0 auto;
        padding: 48px 20px 64px;
      }

      .panel {
        background: color-mix(in srgb, var(--panel) 90%, white 10%);
        border: 1px solid var(--line);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 18px 40px rgba(90, 62, 30, 0.12);
      }

      h1,
      h2 {
        margin: 0 0 12px;
        line-height: 1.1;
        letter-spacing: -0.04em;
      }

      h1 {
        font-size: clamp(2rem, 4vw, 3rem);
      }

      p {
        margin: 0 0 16px;
        line-height: 1.6;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 16px;
        margin-top: 24px;
      }

      .card {
        display: block;
        text-decoration: none;
        color: inherit;
        border: 1px solid var(--line);
        border-radius: 18px;
        padding: 18px;
        background: rgba(255, 255, 255, 0.45);
      }

      .card strong {
        display: block;
        margin-bottom: 8px;
        font-size: 1.05rem;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="panel">
        <h1>hello_ymfm_wasm exsample</h1>
        <p>
          Small runnable sample set for YM2612 browser playback and embedding.
        </p>

        <div class="grid">
          <a class="card" href="./demos/beep.html">
            <strong>YM2612 Beep Demo</strong>
            Minimal YM2612 browser playback check.
          </a>
          <a class="card" href="./demos/vgm.html">
            <strong>YM2612 VGM Demo</strong>
            Load and play YM2612 + PSG focused VGM files.
          </a>
          <a class="card" href="./demos/megasynth_embeded.html">
            <strong>MegaDriveSynth Embedded Demo</strong>
            Higher-level browser embedding sample.
          </a>
          <a class="card" href="./demos/playground_runtime.html">
            <strong>Playground Runtime Embedded Demo</strong>
            Small game/app-facing sample using put/play/stop.
          </a>
          <a class="card" href="./info/ym2612synth_audioworklet.html">
            <strong>YM2612Synth AudioWorklet Demo</strong>
            Lower-level AudioWorklet-oriented reference page.
          </a>
        </div>
      </section>
    </main>
  </body>
</html>
EOF

# Same complete runtime payload as the standalone runtime ZIP.
node "${ROOT_DIR}/scripts/copy_full_web_runtime.mjs" "${STAGE_DIR}" js

# Validate local imports and page references before publishing the archive.
node "${ROOT_DIR}/scripts/check_analyzer_package.mjs" "${STAGE_DIR}"
node "${ROOT_DIR}/scripts/check_web_runtime.mjs" "${STAGE_DIR}"

(
  cd "${STAGE_DIR}"
  zip -r "${ZIP_PATH}" .
)

echo "created stage: ${STAGE_DIR}"
echo "created zip: ${ZIP_PATH}"
