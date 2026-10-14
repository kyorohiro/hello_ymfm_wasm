import { MegaDriveSynth } from "../js/megasynth.js";

export function createVoices(
  voiceCount
) {
  return Array.from(
    { length: voiceCount },
    (_, channel) => ({
      channel,
      held: false,
      key: null,
      startedAt: 0,
      basePitch: null,
    })
  );
}

let nextVoiceSearchStart = 0;

export function attachOutputEnvelopeTap({
  megaSynth,
  onEnvelope,
}) {
  if (!megaSynth?.node) {
    return;
  }

  megaSynth.node.port.addEventListener(
    "message",
    (event) => {
      const message = event.data;

      if (
        message?.type !==
        "output-envelope"
      ) {
        return;
      }

      if (
        message.rmsValues instanceof
        Float32Array
      ) {
        onEnvelope(message.rmsValues);
        return;
      }

      if (
        Array.isArray(
          message.rmsValues
        )
      ) {
        onEnvelope(message.rmsValues);
      }
    }
  );

  // Worklets send envelope data only when a display explicitly requests it.
  megaSynth.setOutputEnvelopeOptions({
    samplesPerPoint: 128,
    pointsPerMessage: 16,
  });
}

export function chooseVoice(voices) {
  if (voices.length === 0) {
    return null;
  }

  for (
    let offset = 0;
    offset < voices.length;
    offset += 1
  ) {
    const index =
      (nextVoiceSearchStart + offset) %
      voices.length;
    const voice = voices[index];

    if (!voice.held) {
      nextVoiceSearchStart =
        (index + 1) % voices.length;
      return voice;
    }
  }

  let oldest = voices[0];

  for (const voice of voices) {
    if (
      voice.startedAt <
      oldest.startedAt
    ) {
      oldest = voice;
    }
  }

  nextVoiceSearchStart =
    (oldest.channel + 1) %
    voices.length;

  return oldest;
}

export function resetVoiceState({
  voices,
  activeKeys,
  updateKeyboardVisuals,
}) {
  for (const voice of voices) {
    voice.held = false;
    voice.key = null;
    voice.startedAt = 0;
    voice.basePitch = null;
  }

  nextVoiceSearchStart = 0;

  activeKeys.clear();
  updateKeyboardVisuals();
}

export function clearInputState({
  heldKeys,
  activePointers,
  voices,
  activeKeys,
  updateKeyboardVisuals,
  onCleared,
}) {
  heldKeys.clear();
  activePointers.clear();
  resetVoiceState({
    voices,
    activeKeys,
    updateKeyboardVisuals,
  });
  onCleared?.();
}

export function stopAllNotes({
  synth,
  voices,
  heldKeys,
  activePointers,
  activeKeys,
  updateKeyboardVisuals,
  onCleared,
}) {
  if (!synth) {
    return;
  }

  for (const voice of voices) {
    synth.noteOff(voice.channel);
  }

  clearInputState({
    heldKeys,
    activePointers,
    voices,
    activeKeys,
    updateKeyboardVisuals,
    onCleared,
  });
}

export async function initializeDirectAudio({
  audioContext,
  workletUrl,
  ym2612WasmUrl,
  outputNode,
  setStatus,
}) {
  setStatus(
    "Loading YM2612 MegaDriveSynth..."
  );

  const megaSynth =
    new MegaDriveSynth({
      audioContext,
      workletUrl,
      ym2612WasmUrl,
      outputNode,
    });

  await megaSynth.start();

  return {
    megaSynth,
    synth: megaSynth.fm,
  };
}
