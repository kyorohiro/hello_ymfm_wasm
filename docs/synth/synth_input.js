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

    if (
      getAudioReadyPromise() &&
      !getSynth()
    ) {
      setStatus(
        "Preparing audio..."
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

    synth.noteOn(
      voice.channel,
      entry.pitch.block,
      entry.pitch.fnum
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
    console.log("keydown", {
      key: event.key,
      code: event.code,
      keyCode: event.keyCode,
      which: event.which,
      shiftKey: event.shiftKey,
    });

    const key =
      event.key.toLowerCase();
    const keyLayout =
      getKeyLayout();

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
    const keyLayout =
      getKeyLayout();

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
    console.log(
      "attachWindowInput"
    );

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
