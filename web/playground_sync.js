/**
 * @file playground_sync.js
 * 実行環境: Browser / Node.js
 * 依存: 注入された状態・UI コールバック。実際の UI 更新環境はコールバックに依存する。
 */
/**
 * Find the first preset name whose value is the same object as the supplied preset.
 * @template T
 * @param {Record<string, T>} presets Named preset objects.
 * @param {string[]} presetOrder Search order.
 * @param {T} preset Object to match by identity.
 * @returns {string | null} First matching name, or null.
 */
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

/**
 * Forward a synth change notification to the operator editor; ignore unknown events.
 * @param {{type: string, channel?: number, preset?: object, operator?: number, params?: object, algorithm?: number, feedback?: number, enabled?: boolean, frequency?: number, left?: boolean, right?: boolean, ams?: number, pms?: number} | null} event Synth notification.
 * @param {{operatorTab: {syncReset: () => void, syncPreset: (channel: number, name: string | null, preset: object) => void, syncOperator: (channel: number, operator: number, params: object) => void, syncAlgo: (channel: number, algorithm: number, feedback: number) => void, syncLfo: (enabled: boolean, frequency: number) => void, syncPan: (channel: number, left: boolean, right: boolean, ams: number, pms: number) => void}, presets: Record<string, object>, presetOrder: string[]}} options Editor callbacks and named presets.
 * @returns {void}
 */
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

/**
 * Expose the Playground FM facade while forwarding calls to the current synth.
 * @param {import('./ym2612synth.js').YM2612Synth} targetSynth Synth to delegate to.
 * @returns Forwarding FM controls with access to the same DAC API.
 */
export function createFmProxy(
  targetSynth
) {
  return {
    get dac() { return targetSynth.dac; },
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
    setOperators(channel, entries) {
      targetSynth.setOperators(channel, entries);
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
    setFrequency(channel, block, fnum) {
      targetSynth.setFrequency(
        channel,
        block,
        fnum
      );
    },
    keyOn(channel, operators) {
      targetSynth.keyOn(
        channel,
        operators
      );
    },
    keyOff(channel, operators) {
      targetSynth.keyOff(
        channel,
        operators
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
    scheduleWrites(entries) {
      targetSynth.scheduleWrites(entries);
    },
    clearScheduledWrites() {
      targetSynth.clearScheduledWrites();
    },
    loadDacBank(name, bytes) {
      targetSynth.loadDacBank(name, bytes);
    },
    playDacBank(name, time) {
      targetSynth.playDacBank(name, time);
    },
    clearDacPlayback() {
      targetSynth.clearDacPlayback();
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
