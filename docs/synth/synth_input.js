import {bendPitch} from './synth_pitch_bend.js';

function isEditingTarget(target) {
  if(target?.closest?.('dialog[open],#synthFileContextMenu'))return true;
  const control=target?.closest?.('input,textarea,select,[contenteditable="true"]');
  // Performance wheels keep letter keys available while their own navigation
  // keys adjust the slider. File-name inputs consume ordinary text instead.
  return Boolean(control&&!control.matches?.('input[type="range"]'));
}

export function createSynthInputController({
  getKeyLayout,
  findLayoutEntry,
  hasLayoutKey,
  heldKeys,
  activePointers,
  activeKeys,
  voices,
  getAudioReadyPromise,
  getSynth,
  getPitchBend = () => 0,
  isInputEnabled = () => true,
  ensureAudioReady,
  chooseVoice,
  updateKeyboardVisuals,
  setStatus,
  stopAllNotes,
  onShiftFret,
  onShiftStringWindow,
  onToggleRecord,
}) {
  async function pressKey(key) {
    if (!isInputEnabled()) return;
    heldKeys.add(key);
    const keyLayout =
      getKeyLayout();

    const entry =
      findLayoutEntry(
        keyLayout,
        key
      );

    if (
      !entry ||
      activeKeys.has(key)
    ) {
      return;
    }

    if (!getSynth()) {
      if (!getAudioReadyPromise()) {
        void ensureAudioReady().catch(
          (error) => {
            console.error(error);
            setStatus(
              `Error: ${error.message}`
            );
          }
        );
      }

      setStatus(
        "Preparing audio... press again when ready."
      );
      return;
    }

    try {
      await ensureAudioReady();
    } catch (error) {
      console.error(error);
      setStatus(
        `Error: ${error.message}`
      );
      return;
    }

    // The key may have been released while waiting for audio initialization.
    if (
      heldKeys.has(key) === false
    ) {
      return;
    }

    const synth = getSynth();

    if (!synth) {
      return;
    }

    const voice =
      chooseVoice(voices);

    if (voice.held) {
      synth.noteOff(
        voice.channel
      );

      if (voice.key) {
        activeKeys.delete(
          voice.key
        );
      }
    }

    voice.basePitch = {...entry.pitch};
    const pitch = bendPitch(voice.basePitch, getPitchBend());
    synth.noteOn(
      voice.channel,
      pitch.block,
      pitch.fnum
    );

    voice.held = true;
    voice.key = key;
    voice.startedAt =
      performance.now();

    activeKeys.set(
      key,
      voice.channel
    );

    updateKeyboardVisuals();

    setStatus(
      `Playing ${entry.noteName} on channel ${voice.channel + 1}.`
    );
  }

  function releaseKey(key) {
    heldKeys.delete(key);

    const synth = getSynth();

    if (!synth) {
      return;
    }

    const channel =
      activeKeys.get(key);

    if (channel === undefined) {
      return;
    }

    synth.noteOff(channel);

    activeKeys.delete(key);

    voices[channel].held = false;
    voices[channel].key = null;
    voices[channel].startedAt = 0;

    updateKeyboardVisuals();
  }

  function releasePointerKey(pointerId) {
    const key =
      activePointers.get(pointerId);

    if (!key) {
      return;
    }

    activePointers.delete(pointerId);
    releaseKey(key);
  }

  async function handlePointerDown(
    event,
    entry,
    button
  ) {
    activePointers.set(
      event.pointerId,
      entry.key
    );
    button.setPointerCapture(
      event.pointerId
    );

    await pressKey(entry.key);
  }

  function handlePointerUp(
    event,
    entry,
    button
  ) {
    if (
      button.hasPointerCapture(
        event.pointerId
      )
    ) {
      button.releasePointerCapture(
        event.pointerId
      );
    }

    releasePointerKey(
      event.pointerId
    );
  }

  function handlePointerCancel(
    event,
    entry,
    button
  ) {
    if (
      button.hasPointerCapture(
        event.pointerId
      )
    ) {
      button.releasePointerCapture(
        event.pointerId
      );
    }

    releasePointerKey(
      event.pointerId
    );
  }

  function handleKeyDown(event) {
    // Leave native application shortcuts (for example Cmd+Q) to the host.
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Naming files and choosing dialog actions must not play notes or consume
    // cursor/space keys. Pointer file selection still leaves performance focus.
    if (isEditingTarget(event.target)) return;
    const key =
      event.key.toLowerCase();
    const keyLayout =
      getKeyLayout();

    if(event.target?.closest?.('input[type="range"]')&&!hasLayoutKey(keyLayout,key))return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onShiftFret?.(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      onShiftFret?.(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      onShiftStringWindow?.(1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onShiftStringWindow?.(-1);
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      if (event.repeat) {
        return;
      }
      onToggleRecord?.();
      return;
    }

    if (
      !hasLayoutKey(
        keyLayout,
        key
      )
    ) {
      return;
    }

    event.preventDefault();

    if (event.repeat) {
      return;
    }

    void pressKey(key);
  }

  function handleKeyUp(event) {
    const key =
      event.key.toLowerCase();
    if (isEditingTarget(event.target)) {
      // Release a note started before an input gained focus without disrupting
      // normal text editing or a native dialog control.
      releaseKey(key);
      return;
    }
    const keyLayout =
      getKeyLayout();

    if(event.target?.closest?.('input[type="range"]')&&!hasLayoutKey(keyLayout,key))return;

    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      return;
    }

    if (
      !hasLayoutKey(
        keyLayout,
        key
      )
    ) {
      return;
    }

    event.preventDefault();

    releaseKey(key);
  }

  function attachWindowInput() {
    const onPointerUp = (event) => {
      releasePointerKey(
        event.pointerId
      );
    };
    const onPointerCancel =
      (event) => {
        releasePointerKey(
          event.pointerId
        );
      };
    const onBlur = () => {
      stopAllNotes();
    };

    window.addEventListener(
      "pointerup",
      onPointerUp
    );
    window.addEventListener(
      "pointercancel",
      onPointerCancel
    );
    window.addEventListener(
      "keydown",
      handleKeyDown
    );
    window.addEventListener(
      "keyup",
      handleKeyUp
    );
    window.addEventListener(
      "blur",
      onBlur
    );

    return () => {
      window.removeEventListener(
        "pointerup",
        onPointerUp
      );
      window.removeEventListener(
        "pointercancel",
        onPointerCancel
      );
      window.removeEventListener(
        "keydown",
        handleKeyDown
      );
      window.removeEventListener(
        "keyup",
        handleKeyUp
      );
      window.removeEventListener(
        "blur",
        onBlur
      );
    };
  }

  return {
    pressKey,
    releaseKey,
    releasePointerKey,
    handlePointerDown,
    handlePointerUp,
    handlePointerCancel,
    attachWindowInput,
  };
}
