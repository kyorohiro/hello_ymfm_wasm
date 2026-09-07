import ym2612ModuleFactory from "../../generated/ym2612_wasm.js";
import { createYm2612, YM2612_CLOCK } from "../../js/ym2612.js";
import {
  YM2612DirectTransport,
  YM2612Synth,
} from "../../js/ym2612synth.js";
import { parseTfi } from "../../js/tfi.js";
import { parseVgi } from "../../js/vgi.js";

const statusElement = document.getElementById("status");
const summaryElement = document.getElementById("summary");
const presetElement = document.getElementById("presetJson");
const fileInput = document.getElementById("tfiFile");
const playButton = document.getElementById("playButton");
const stopButton = document.getElementById("stopButton");

let audioContext = null;
let currentSource = null;
let ym2612 = null;
let synth = null;
let currentPreset = null;
let currentFormat = null;

function setStatus(message) {
  statusElement.textContent = message;
}

function renderPreset(preset) {
  if (!preset) {
    summaryElement.textContent = "No patch loaded.";
    presetElement.textContent = "{}";
    return;
  }

  const op1 = preset.operators[1];
  const op2 = preset.operators[2];
  const op3 = preset.operators[3];
  const op4 = preset.operators[4];

  summaryElement.textContent =
    `ALG ${preset.algorithm}, FB ${preset.feedback} | ` +
    `OP1 multi ${op1.multi}, OP2 multi ${op2.multi}, OP3 multi ${op3.multi}, OP4 multi ${op4.multi}`;
  presetElement.textContent = JSON.stringify(preset, null, 2);
}

async function ensureReady() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  if (!ym2612) {
    ym2612 = await createYm2612(ym2612ModuleFactory);
    const transport = new YM2612DirectTransport(ym2612);
    synth = new YM2612Synth({ transport });
  }
}

function stopCurrentSource() {
  if (currentSource) {
    try {
      currentSource.stop();
    } catch (_error) {
      // already stopped
    }
    currentSource.disconnect();
    currentSource = null;
  }
}

function buildAudioFromCurrentPreset() {
  synth.reset();
  synth.setPreset(0, currentPreset);
  synth.setPan(0, true, true);
  synth.noteOn(0, 4, 553);

  const seconds = 1.4;
  const sampleRate = ym2612.sampleRate(YM2612_CLOCK);
  const frameCount = Math.floor(sampleRate * seconds);
  const releaseFrame = Math.floor(sampleRate * 0.8);

  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);

  for (let index = 0; index < frameCount; index += 1) {
    if (index === releaseFrame) {
      synth.noteOff(0);
    }
    const { left: sampleLeft, right: sampleRight } = ym2612.generateStereo(1);
    left[index] = sampleLeft[0];
    right[index] = sampleRight[0];
  }

  const buffer = audioContext.createBuffer(2, frameCount, sampleRate);
  buffer.copyToChannel(left, 0);
  buffer.copyToChannel(right, 1);
  return buffer;
}

fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  setStatus(`Loading ${file.name}...`);

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    currentFormat = file.name.toLowerCase().endsWith(".vgi") || bytes.length === 43
      ? "VGI"
      : "TFI";
    currentPreset = currentFormat === "VGI" ? parseVgi(bytes) : parseTfi(bytes);
    renderPreset(currentPreset);
    playButton.disabled = false;
    setStatus(`Loaded ${file.name} (${currentFormat}). Ready to play.`);
  } catch (error) {
    currentPreset = null;
    renderPreset(null);
    playButton.disabled = true;
    currentFormat = null;
    setStatus(`Failed to parse patch: ${error.message}`);
  }
});

playButton.addEventListener("click", async () => {
  if (!currentPreset) {
    setStatus("Load a TFI or VGI file first.");
    return;
  }

  playButton.disabled = true;
  stopButton.disabled = false;
  setStatus("Preparing audio...");

  try {
    await ensureReady();
    stopCurrentSource();

    const buffer = buildAudioFromCurrentPreset();
    currentSource = audioContext.createBufferSource();
    currentSource.buffer = buffer;
    currentSource.connect(audioContext.destination);
    currentSource.addEventListener("ended", () => {
      currentSource = null;
      stopButton.disabled = true;
      playButton.disabled = false;
      setStatus("Playback finished.");
    }, { once: true });
    currentSource.start();
    setStatus(`Playing loaded ${currentFormat} with YM2612Synth.`);
  } catch (error) {
    stopCurrentSource();
    stopButton.disabled = true;
    playButton.disabled = false;
    setStatus(`Playback failed: ${error.message}`);
  }
});

stopButton.addEventListener("click", () => {
  stopCurrentSource();
  stopButton.disabled = true;
  playButton.disabled = currentPreset === null;
  setStatus("Stopped.");
});

renderPreset(null);
