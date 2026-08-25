export function findPresetNameByReference(
  presets,
  presetOrder,
  preset
) {
  for (const presetName of presetOrder) {
    if (presets[presetName] === preset) {
      return presetName;
    }
  }

  return null;
}

export function handleMegaSynthEvent(
  event,
  options
) {
  const {
    operatorTab,
    presets,
    presetOrder,
  } = options;

  if (!event || typeof event !== "object") {
    return;
  }

  if (event.type === "reset") {
    operatorTab.syncReset();
    return;
  }

  if (event.type === "setPreset") {
    operatorTab.syncPreset(
      event.channel,
      findPresetNameByReference(
        presets,
        presetOrder,
        event.preset
      ),
      event.preset
    );
    return;
  }

  if (event.type === "setOperator") {
    operatorTab.syncOperator(
      event.channel,
      event.operator,
      event.params
    );
    return;
  }

  if (event.type === "setAlgo") {
    operatorTab.syncAlgo(
      event.channel,
      event.algorithm,
      event.feedback
    );
    return;
  }

  if (event.type === "setLfo") {
    operatorTab.syncLfo(
      event.enabled,
      event.frequency
    );
    return;
  }

  if (event.type === "setPan") {
    operatorTab.syncPan(
      event.channel,
      event.left,
      event.right,
      event.ams,
      event.pms
    );
  }
}

export function createFmProxy(
  targetSynth
) {
  return {
    reset() {
      targetSynth.reset();
    },
    setPreset(channel, preset) {
      targetSynth.setPreset(
        channel,
        preset
      );
    },
    setOperator(
      channel,
      operator,
      params
    ) {
      targetSynth.setOperator(
        channel,
        operator,
        params
      );
    },
    setAlgo(
      channel,
      algorithm,
      feedback = 0
    ) {
      targetSynth.setAlgo(
        channel,
        algorithm,
        feedback
      );
    },
    setPan(
      channel,
      left,
      right,
      ams,
      pms
    ) {
      targetSynth.setPan(
        channel,
        left,
        right,
        ams,
        pms
      );
    },
    setLfo(enabled, frequency) {
      targetSynth.setLfo(
        enabled,
        frequency
      );
    },
    setChannel3SpecialMode(enabled) {
      targetSynth.setChannel3SpecialMode(
        enabled
      );
    },
    setChannel3SpecialFrequency(
      operator,
      block,
      fnum
    ) {
      targetSynth.setChannel3SpecialFrequency(
        operator,
        block,
        fnum
      );
    },
    setDacEnabled(enabled) {
      targetSynth.setDacEnabled(
        enabled
      );
    },
    writeDac(value) {
      targetSynth.writeDac(
        value
      );
    },
    noteOn(channel, block, fnum) {
      targetSynth.noteOn(
        channel,
        block,
        fnum
      );
    },
    noteOff(channel) {
      targetSynth.noteOff(
        channel
      );
    },
    write(port, register, value) {
      targetSynth.write(
        port,
        register,
        value
      );
    },
    writeAddress(port, register) {
      targetSynth.writeAddress(
        port,
        register
      );
    },
    writeData(value) {
      targetSynth.writeData(
        value
      );
    },
    read(offset) {
      return targetSynth.read(
        offset
      );
    },
    readStatus() {
      return targetSynth.readStatus();
    },
    getIrq() {
      if (
        !targetSynth.transport ||
        typeof targetSynth.transport.getIrq !==
          "function"
      ) {
        return false;
      }
      return targetSynth.transport.getIrq();
    },
    rawWrite(port, register, value) {
      targetSynth.rawWrite(
        port,
        register,
        value
      );
    },
    get transport() {
      return targetSynth.transport;
    },
  };
}
