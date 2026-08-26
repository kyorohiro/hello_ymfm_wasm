const RECORDING_FORMAT =
  "megasynth-recording-v1";
const FM_CHANNELS = [0, 1, 2, 3, 4, 5];

export class MegaSynthRecordingManager {
  constructor(options = {}) {
    this.synth =
      options.synth ?? null;
    this.now =
      options.now ??
      (() => performance.now() / 1000);
    this.setTimer =
      options.setTimer ??
      ((fn, delayMs) => window.setTimeout(fn, delayMs));
    this.clearTimer =
      options.clearTimer ??
      ((timerId) => window.clearTimeout(timerId));

    this.recording = false;
    this.playing = false;
    this.loopPlayback = false;
    this.currentRecording = null;
    this.lastRecording = null;
    this.importedRecording = null;
    this.activePlaybackRecording = null;
    this.playbackTimers = [];
  }

  attachSynth(synth) {
    this.synth = synth;
  }

  start() {
    this.stopPlayback();
    this.recording = true;
    this.currentRecording = {
      format: RECORDING_FORMAT,
      version: 1,
      startedAt: this.now(),
      durationSeconds: 0,
      initialState: this._captureSynthState(),
      commands: [],
    };

    return this.exportCurrentRecording();
  }

  stop() {
    if (!this.recording || !this.currentRecording) {
      return this.exportRecording();
    }

    this.recording = false;
    this.currentRecording.durationSeconds =
      Math.max(
        0,
        this.now() -
          this.currentRecording.startedAt
      );
    this.lastRecording =
      this._cloneRecording(
        this.currentRecording
      );
    this.currentRecording = null;
    return this.exportRecording();
  }

  isRecording() {
    return this.recording;
  }

  isPlaying() {
    return this.playing;
  }

  recordCommand(command) {
    if (!this.recording || !this.currentRecording) {
      return;
    }

    const time =
      Math.max(
        0,
        this.now() -
          this.currentRecording.startedAt
      );

    this.currentRecording.commands.push({
      time,
      ...structuredCloneCompat(command),
    });
  }

  exportCurrentRecording() {
    if (!this.currentRecording) {
      return null;
    }

    return this._cloneRecording({
      ...this.currentRecording,
      durationSeconds: Math.max(
        this.currentRecording.durationSeconds,
        this.now() -
          this.currentRecording.startedAt
      ),
    });
  }

  exportRecording() {
    if (this.recording) {
      return this.exportCurrentRecording();
    }

    if (this.lastRecording) {
      return this._cloneRecording(
        this.lastRecording
      );
    }

    if (this.importedRecording) {
      return this._cloneRecording(
        this.importedRecording
      );
    }

    return null;
  }

  importRecording(recording) {
    const normalized =
      this._normalizeRecording(
        recording
      );
    this.importedRecording =
      normalized;
    this.lastRecording =
      this._cloneRecording(
        normalized
      );
    return this.exportRecording();
  }

  play(recording = null, options = {}) {
    const selectedRecording =
      recording
        ? this._normalizeRecording(
            recording
          )
        : this.exportRecording();

    if (!selectedRecording) {
      return null;
    }

    this.stopPlayback();
    this.playing = true;
    this.loopPlayback =
      options.loop === true;
    this.activePlaybackRecording =
      this._cloneRecording(
        selectedRecording
      );

    this._playCycle(
      this.activePlaybackRecording,
      options
    );

    return this._cloneRecording(
      selectedRecording
    );
  }

  _playCycle(recording, options = {}) {
    if (!this.playing) {
      return;
    }

    if (options.reset !== false) {
      this.synth?.reset?.();
    }

    this._applyInitialState(
      recording.initialState,
      options
    );

    for (const command of recording.commands) {
      const delayMs =
        Math.max(
          0,
          command.time * 1000
        );

      const timerId =
        this.setTimer(() => {
          this._applyCommand(
            command,
            options
          );
        }, delayMs);

      this.playbackTimers.push(timerId);
    }

    const cycleDelayMs =
      Math.max(
        0,
        recording.durationSeconds *
          1000
      ) + 10;
    const cycleTimerId =
      this.setTimer(() => {
        if (!this.playing) {
          return;
        }

        if (this.loopPlayback) {
          this._playCycle(
            recording,
            options
          );
          return;
        }

        this.stopPlayback();
      }, cycleDelayMs);
    this.playbackTimers.push(cycleTimerId);
  }

  stopPlayback() {
    for (const timerId of this.playbackTimers) {
      this.clearTimer(timerId);
    }
    this.playbackTimers = [];
    this.playing = false;
    this.loopPlayback = false;
    this.activePlaybackRecording =
      null;

    for (const channel of FM_CHANNELS) {
      this.synth?.noteOff?.(channel);
    }
  }

  _applyInitialState(
    initialState,
    options = {}
  ) {
    if (
      !this.synth ||
      !initialState?.channels
    ) {
      return;
    }

    if (options.ignorePatch === true) {
      return;
    }

    for (
      let channel = 0;
      channel < initialState.channels.length;
      channel += 1
    ) {
      const channelState =
        initialState.channels[channel];

      if (!channelState) {
        continue;
      }

      if (
        options.ignoreOperators !==
        true
      ) {
        for (
          let operator = 0;
          operator <
          channelState.operators.length;
          operator += 1
        ) {
          this.synth.setOperator(
            channel,
            operator,
            channelState.operators[
              operator
            ]
          );
        }
      }

      this.synth.setAlgo(
        channel,
        channelState.algorithm,
        channelState.feedback
      );
      this.synth.setPan(
        channel,
        channelState.left,
        channelState.right
      );
    }
  }

  _applyCommand(
    command,
    options = {}
  ) {
    if (!this.synth || !this.playing) {
      return;
    }

    if (command.type === "reset") {
      this.synth.reset();
      return;
    }

    if (command.type === "setOperator") {
      if (
        options.ignoreOperators ===
        true
      ) {
        return;
      }

      this.synth.setOperator(
        command.channel,
        command.operator,
        command.params
      );
      return;
    }

    if (command.type === "setAlgo") {
      if (
        options.ignorePatch === true
      ) {
        return;
      }

      this.synth.setAlgo(
        command.channel,
        command.algorithm,
        command.feedback
      );
      return;
    }

    if (command.type === "setPan") {
      if (
        options.ignorePatch === true
      ) {
        return;
      }

      this.synth.setPan(
        command.channel,
        command.left,
        command.right
      );
      return;
    }

    if (command.type === "noteOn") {
      this.synth.noteOn(
        command.channel,
        command.block,
        command.fnum
      );
      return;
    }

    if (command.type === "noteOff") {
      this.synth.noteOff(
        command.channel
      );
    }
  }

  _captureSynthState() {
    if (
      !this.synth ||
      typeof this.synth.getState !==
        "function"
    ) {
      return null;
    }

    return structuredCloneCompat(
      this.synth.getState()
    );
  }

  _normalizeRecording(recording) {
    if (
      !recording ||
      typeof recording !== "object"
    ) {
      throw new Error(
        "recording must be an object"
      );
    }

    if (
      recording.format !==
      RECORDING_FORMAT
    ) {
      throw new Error(
        `Unsupported recording format: ${recording.format}`
      );
    }

    return this._cloneRecording(
      recording
    );
  }

  _cloneRecording(recording) {
    return structuredCloneCompat(
      recording
    );
  }
}

function structuredCloneCompat(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}
