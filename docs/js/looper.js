/**
 * Lightweight musical-event looper for MegaSynth / YM2612 browser usage.
 *
 * This first version intentionally records performance-level note events:
 *
 * - noteOn(channel, block, fnum)
 * - noteOff(channel)
 *
 * It does not try to record raw YM2612 register writes yet.
 * The main idea is to keep loop data editable and small.
 */

const ALL_FM_CHANNELS = [0, 1, 2, 3, 4, 5];
const MIN_LOOP_LENGTH_SECONDS = 0.001;

/**
 * @typedef {{
 *   time: number,
 *   type: "noteOn" | "noteOff",
 *   channel: number,
 *   block?: number,
 *   fnum?: number,
 * }} MegaSynthLooperEvent
 */

/**
 * @typedef {{
 *   id: string,
 *   muted: boolean,
 *   startedLoopTime?: number,
 *   patch: object | null,
 *   audio?: unknown,
 *   audioDuration?: number,
 *   events: MegaSynthLooperEvent[],
 *   playbackChannelMap?: Record<string, number>,
 * }} MegaSynthLooperUnit
 */

export class MegaSynthLooper {
  /**
   * @param {{
   *   synth: {
   *     start?: () => Promise<unknown>,
   *     fm?: {
   *       noteOn: (channel: number, block: number, fnum: number) => void,
   *       noteOff: (channel: number) => void,
   *     },
   *     noteOn?: (channel: number, block: number, fnum: number) => void,
   *     noteOff?: (channel: number) => void,
   *   },
   *   now?: () => number,
   *   setTimer?: (fn: () => void, delayMs: number) => unknown,
   *   clearTimer?: (timerId: unknown) => void,
   *   liveTarget?: {
   *     noteOn: (channel: number, block: number, fnum: number) => void,
   *     noteOff: (channel: number) => void,
   *   },
   *   playbackTarget?: {
   *     noteOn: (channel: number, block: number, fnum: number) => void,
   *     noteOff: (channel: number) => void,
   *   },
   *   getPatch?: () => object | null,
   *   applyPatch?: (patch: object, channel: number, event: MegaSynthLooperEvent) => void,
   *   startAudioCapture?: () => Promise<void> | void,
   *   stopAudioCapture?: () => Promise<{ audio?: unknown, audioDuration?: number } | null> | { audio?: unknown, audioDuration?: number } | null,
   *   scheduleAudioPlayback?: (unit: MegaSynthLooperUnit, startTime: number) => void,
   *   stopAudioPlayback?: (unit?: MegaSynthLooperUnit | string | null) => void,
   *   onStateChange?: (detail: { reason: string, unit?: MegaSynthLooperUnit | null, auto?: boolean }) => void,
   * }} options
   */
  constructor(options = {}) {
    if (!options.synth) {
      throw new Error("MegaSynthLooper requires a synth option");
    }

    this.synth = options.synth;
    this.now =
      options.now ??
      (() => performance.now() / 1000);
    this.setTimer =
      options.setTimer ??
      ((fn, delayMs) => window.setTimeout(fn, delayMs));
    this.clearTimer =
      options.clearTimer ??
      ((timerId) => window.clearTimeout(timerId));
    this.liveTarget =
      options.liveTarget ??
      this._resolvePerformanceTarget(
        options.synth
      );
    this.playbackTarget =
      options.playbackTarget ??
      this.liveTarget;
    this.getPatch =
      options.getPatch ??
      (() => null);
    this.applyPatch =
      options.applyPatch ??
      (() => {});
    this.startAudioCapture =
      options.startAudioCapture ??
      (() => {});
    this.stopAudioCapture =
      options.stopAudioCapture ??
      (() => null);
    this.scheduleAudioPlayback =
      options.scheduleAudioPlayback ??
      null;
    this.stopAudioPlayback =
      options.stopAudioPlayback ??
      (() => {});
    this.onStateChange =
      options.onStateChange ??
      (() => {});

    this.running = false;
    this.recording = false;
    this.armed = false;
    this.loopLength = null;
    this.startedAt = null;
    this.loopStartedAt = null;
    this.currentUnit = null;
    this.units = [];

    this._scheduledTimers = [];
    this._activeChannels = new Set();
    this._recordStopTimer = null;
    this._armTimer = null;
  }

  async start() {
    if (this.running) {
      return this;
    }

    if (typeof this.synth.start === "function") {
      await this.synth.start();
    }

    this.running = true;
    this.startedAt = this.now();

    if (this.loopLength !== null && this.units.length > 0) {
      this.loopStartedAt = this.startedAt;
      this._scheduleLoopCycle(this.loopStartedAt);
    }

    this._notifyStateChange("start");
    return this;
  }

  async stop() {
    if (!this.running && !this.recording) {
      return;
    }

    if (this.recording) {
      await this.finishRecording();
    }

    this.running = false;
    this.recording = false;
    this.armed = false;
    this.startedAt = null;
    this.loopStartedAt = null;
    this.currentUnit = null;

    this._clearScheduledTimers();
    this._clearRecordStopTimer();
    this._clearArmTimer();
    this.stopAudioPlayback();
    this._allNotesOff();
    this._notifyStateChange("stop");
  }

  async clear() {
    await this.stop();
    this.loopLength = null;
    this.units = [];
    this._rebuildPlaybackChannelMaps();
    this._notifyStateChange("clear");
  }

  async toggleRecord() {
    if (!this.running) {
      throw new Error("MegaSynthLooper must be started before recording");
    }

    if (this.recording) {
      return this.finishRecording();
    }

    return this.startRecording();
  }

  async startRecording() {
    if (!this.running) {
      throw new Error("MegaSynthLooper must be started before recording");
    }

    if (this.recording) {
      return this.currentUnit;
    }

    const startedAt = this.now();
    const startedLoopTime =
      this.loopLength === null
        ? 0
        : this._getLoopPosition(startedAt);
    const nextUnitNumber =
      this.units.length + 1;

    this.currentUnit = {
      id: `unit-${nextUnitNumber}`,
      startedAt,
      startedLoopTime,
      patch: this._clonePatch(
        this.getPatch()
      ),
      events: [],
    };

    await this.startAudioCapture();
    this.recording = true;
    this.armed = false;
    this._clearArmTimer();
    this._scheduleRecordStopTimer();
    this._notifyStateChange("record-start");

    return this.currentUnit;
  }

  async finishRecording(options = {}) {
    if (!this.recording || !this.currentUnit) {
      return null;
    }

    const auto =
      options.auto === true;
    const finishedAt = this.now();
    const currentUnit = this.currentUnit;
    this.currentUnit = null;
    this.recording = false;
    this._clearRecordStopTimer();
    const audioResult =
      await this.stopAudioCapture();
    const hasEvents =
      currentUnit.events.length > 0;
    const readyAt = this.now();

    if (!hasEvents) {
      if (
        auto &&
        this.running &&
        this.loopLength !== null
      ) {
        this.currentUnit = {
          id: currentUnit.id,
          startedAt: readyAt,
          startedLoopTime: 0,
          patch: this._clonePatch(
            currentUnit.patch
          ),
          events: [],
        };
        await this.startAudioCapture();
        this.recording = true;
        this._scheduleRecordStopTimer();
        this._notifyStateChange(
          "record-carry",
          {
            auto: true,
          }
        );
        return null;
      }

      this._notifyStateChange(
        "record-empty",
        {
          auto,
        }
      );
      return null;
    }

    const recordedUnit = {
      id: currentUnit.id,
      muted: false,
      startedLoopTime:
        currentUnit.startedLoopTime,
      patch: this._clonePatch(
        currentUnit.patch
      ),
      audio:
        audioResult?.audio ?? null,
      audioDuration:
        audioResult?.audioDuration ??
        0,
      events: currentUnit.events.slice(),
      playbackChannelMap: {},
    };

    this.units.push(recordedUnit);

    if (this.loopLength === null) {
      this._assignPlaybackChannelMap(
        recordedUnit
      );
      this.loopLength = Math.max(
        MIN_LOOP_LENGTH_SECONDS,
        finishedAt - currentUnit.startedAt
      );
      this.loopStartedAt = readyAt;
      this._clearScheduledTimers();
      if (this.running) {
        if (
          this._unitHasAudio(
            recordedUnit
          )
        ) {
          this._playAudioUnitNow(
            recordedUnit,
            readyAt
          );
          this._scheduleLoopCycle(
            this.loopStartedAt +
              this.loopLength
          );
        } else {
          this._scheduleLoopCycle(
            this.loopStartedAt
          );
        }
      }
    } else {
      this._assignPlaybackChannelMap(
        recordedUnit
      );
      if (this.running) {
        if (
          this._unitHasAudio(
            recordedUnit
          )
        ) {
          this._scheduleNextAudioUnitPlayback(
            recordedUnit,
            readyAt
          );
        } else {
          this._scheduleUnitRemainder(
            recordedUnit,
            readyAt
          );
        }
      }
    }

    this._notifyStateChange(
      "record-finish",
      {
        unit: recordedUnit,
        auto,
      }
    );

    return recordedUnit;
  }

  async undo() {
    if (this.recording) {
      const canceledUnitId =
        this.currentUnit?.id ?? null;
      this.currentUnit = null;
      this.recording = false;
      this._clearRecordStopTimer();
      await this.stopAudioCapture();
      this._notifyStateChange(
        "record-cancel",
        {
          unit: canceledUnitId
            ? {
                id: canceledUnitId,
              }
            : null,
        }
      );
      return {
        type: "record-cancel",
        id: canceledUnitId,
      };
    }

    if (this.units.length === 0) {
      return null;
    }

    const removedUnit =
      this.units.pop() ?? null;

    this._rebuildPlaybackChannelMaps();
    this.stopAudioPlayback(
      removedUnit
    );

    if (this.units.length === 0) {
      this.loopLength = null;
      this.loopStartedAt = null;
      this._clearScheduledTimers();
      this._allNotesOffOnTarget(
        this.playbackTarget
      );
    } else if (
      this.running &&
      this.loopLength !== null
    ) {
      const now = this.now();
      const loopPosition =
        this._getLoopPosition(now);
      this._clearScheduledTimers();
      this.loopStartedAt =
        now - loopPosition;
      this._scheduleLoopRemainder(
        now
      );
      this._scheduleLoopCycle(
        this.loopStartedAt +
          this.loopLength
      );
    }

    this._notifyStateChange(
      "undo",
      {
        unit: removedUnit,
      }
    );

    return removedUnit;
  }

  noteOn(channel, block, fnum) {
    this._dispatchPerformanceEvent(
      {
        type: "noteOn",
        channel,
        block,
        fnum,
      },
      true
    );
  }

  noteOff(channel) {
    this._dispatchPerformanceEvent(
      {
        type: "noteOff",
        channel,
      },
      true
    );
  }

  getState() {
    return {
      running: this.running,
      recording: this.recording,
      armed: this.armed,
      loopLength: this.loopLength,
      startedAt: this.startedAt,
      loopStartedAt: this.loopStartedAt,
      currentUnitId: this.currentUnit?.id ?? null,
      unitCount: this.units.length,
      canUndo:
        !this.recording &&
        this.units.length > 0,
      units: this.units.map((unit) => ({
        id: unit.id,
        muted: unit.muted,
        hasAudio:
          this._unitHasAudio(unit),
        hasPatch: !!unit.patch,
        eventCount: unit.events.length,
      })),
    };
  }

  getUnits() {
    return this.units.map((unit) => ({
      id: unit.id,
      muted: unit.muted,
      patch: this._clonePatch(
        unit.patch
      ),
      startedLoopTime:
        unit.startedLoopTime ?? 0,
      audio:
        unit.audio ?? null,
      audioDuration:
        unit.audioDuration ?? 0,
      playbackChannelMap: {
        ...(unit.playbackChannelMap ?? {}),
      },
      events: unit.events.map((event) => ({ ...event })),
    }));
  }

  _dispatchPerformanceEvent(
    event,
    shouldRecord,
    patch = null,
    playbackChannelMap = null
  ) {
    const target = shouldRecord
      ? this.liveTarget
      : this.playbackTarget;
    const targetChannel = shouldRecord
      ? event.channel
      : this._resolvePlaybackChannel(
          event.channel,
          playbackChannelMap
        );

    if (patch) {
      this.applyPatch(
        this._clonePatch(patch),
        targetChannel,
        event
      );
    }

    if (event.type === "noteOn") {
      target.noteOn(
        targetChannel,
        event.block,
        event.fnum
      );
      this._activeChannels.add(
        targetChannel
      );
    } else if (event.type === "noteOff") {
      target.noteOff(targetChannel);
      this._activeChannels.delete(
        targetChannel
      );
    } else {
      throw new Error(`Unsupported looper event type: ${event.type}`);
    }

    if (shouldRecord) {
      this._recordEvent(event);
    }
  }

  _recordEvent(event) {
    if (!this.recording || !this.currentUnit) {
      return;
    }

    const eventTime = this._getCurrentRecordTime();
    this.currentUnit.events.push({
      ...event,
      time: eventTime,
    });
  }

  _getCurrentRecordTime() {
    const currentTime = this.now();
    const elapsed = currentTime - this.currentUnit.startedAt;

    if (this.loopLength === null) {
      return elapsed;
    }

    return this._wrapLoopTime(
      this.currentUnit.startedLoopTime + elapsed
    );
  }

  _scheduleLoopCycle(cycleStartTime) {
    if (!this.running || this.loopLength === null) {
      return;
    }

    const now = this.now();

    for (const unit of this.units) {
      if (unit.muted) {
        continue;
      }

      if (
        this._unitHasAudio(unit)
      ) {
        this._scheduleAudioUnit(
          unit,
          cycleStartTime,
          now
        );
        continue;
      }

      for (const event of unit.events) {
        const delayMs =
          Math.max(0, (cycleStartTime + event.time - now) * 1000);
        const timerId = this.setTimer(() => {
          if (!this.running) {
            return;
          }
          this._dispatchPerformanceEvent(
            event,
            false,
            unit.patch,
            unit.playbackChannelMap ?? null
          );
        }, delayMs);
        this._scheduledTimers.push(timerId);
      }
    }

    const nextCycleStartTime =
      cycleStartTime + this.loopLength;
    const cycleDelayMs =
      Math.max(0, (nextCycleStartTime - now) * 1000);

    const cycleTimerId = this.setTimer(() => {
      this._pruneScheduledTimers();
      this._scheduleLoopCycle(nextCycleStartTime);
    }, cycleDelayMs);

    this._scheduledTimers.push(cycleTimerId);
  }

  _clearScheduledTimers() {
    for (const timerId of this._scheduledTimers) {
      this.clearTimer(timerId);
    }
    this._scheduledTimers = [];
  }

  _clearRecordStopTimer() {
    if (this._recordStopTimer === null) {
      return;
    }

    this.clearTimer(
      this._recordStopTimer
    );
    this._recordStopTimer = null;
  }

  _clearArmTimer() {
    if (this._armTimer === null) {
      return;
    }

    this.clearTimer(this._armTimer);
    this._armTimer = null;
  }

  _scheduleUnitRemainder(
    unit,
    now = this.now()
  ) {
    if (
      !this.running ||
      this.loopLength === null ||
      this.loopStartedAt === null
    ) {
      return;
    }

    const cycleStartTime =
      now - this._getLoopPosition(now);

    for (const event of unit.events) {
      const eventAbsoluteTime =
        cycleStartTime + event.time;

      if (
        eventAbsoluteTime <=
        now + 0.000001
      ) {
        continue;
      }

      const delayMs =
        Math.max(
          0,
          (eventAbsoluteTime - now) *
            1000
        );

      const timerId = this.setTimer(
        () => {
          if (!this.running) {
            return;
          }

          this._dispatchPerformanceEvent(
            event,
            false,
            unit.patch,
            unit.playbackChannelMap ??
              null
          );
        },
        delayMs
      );

      this._scheduledTimers.push(
        timerId
      );
    }
  }

  _scheduleLoopRemainder(
    now = this.now()
  ) {
    if (
      !this.running ||
      this.loopLength === null ||
      this.loopStartedAt === null
    ) {
      return;
    }

    for (const unit of this.units) {
      if (unit.muted) {
        continue;
      }

      if (
        this._unitHasAudio(unit)
      ) {
        this._scheduleNextAudioUnitPlayback(
          unit,
          now
        );
      } else {
        this._scheduleUnitRemainder(
          unit,
          now
        );
      }
    }
  }

  _scheduleAudioUnit(
    unit,
    cycleStartTime,
    now
  ) {
    if (
      !this.scheduleAudioPlayback
    ) {
      return;
    }

    const unitStartTime =
      cycleStartTime +
      (unit.startedLoopTime ?? 0);

    const lateBySeconds =
      now - unitStartTime;

    if (lateBySeconds > 0.05) {
      return;
    }

    this.scheduleAudioPlayback(
      unit,
      unitStartTime <= now
        ? now + 0.01
        : unitStartTime
    );
  }

  _scheduleNextAudioUnitPlayback(
    unit,
    now = this.now()
  ) {
    if (
      !this.scheduleAudioPlayback ||
      !this._unitHasAudio(unit) ||
      this.loopLength === null ||
      this.loopStartedAt === null
    ) {
      return;
    }

    const epsilon = 0.000001;
    const toleranceSeconds = 0.05;
    const loopPosition =
      this._getLoopPosition(now);
    const cycleStartTime =
      now - loopPosition;
    let nextStartTime =
      cycleStartTime +
      (unit.startedLoopTime ?? 0);

    const lateBySeconds =
      now - nextStartTime;

    if (
      lateBySeconds > epsilon &&
      lateBySeconds <=
        toleranceSeconds
    ) {
      this.scheduleAudioPlayback(
        unit,
        now + 0.01
      );
      return;
    }

    while (
      nextStartTime <=
      now + epsilon
    ) {
      nextStartTime +=
        this.loopLength;
    }

    this.scheduleAudioPlayback(
      unit,
      nextStartTime
    );
  }

  _playAudioUnitNow(
    unit,
    now = this.now()
  ) {
    if (
      !this.scheduleAudioPlayback ||
      !this._unitHasAudio(unit)
    ) {
      return;
    }

    this.scheduleAudioPlayback(
      unit,
      now
    );
  }

  _pruneScheduledTimers() {
    this._scheduledTimers = [];
  }

  _allNotesOff() {
    this._allNotesOffOnTarget(
      this.liveTarget
    );
    this._allNotesOffOnTarget(
      this.playbackTarget
    );

    this._activeChannels.clear();
  }

  _getLoopPosition(currentTime = this.now()) {
    if (this.loopLength === null || this.loopStartedAt === null) {
      return 0;
    }

    return this._wrapLoopTime(
      currentTime - this.loopStartedAt
    );
  }

  _wrapLoopTime(time) {
    if (this.loopLength === null) {
      return time;
    }

    const wrapped =
      time % this.loopLength;

    return wrapped < 0
      ? wrapped + this.loopLength
      : wrapped;
  }

  _allNotesOffOnTarget(target) {
    if (!target || typeof target.noteOff !== "function") {
      return;
    }

    for (const channel of ALL_FM_CHANNELS) {
      target.noteOff(channel);
    }
  }

  _resolvePerformanceTarget(targetSource) {
    if (
      targetSource &&
      typeof targetSource.noteOn === "function" &&
      typeof targetSource.noteOff === "function"
    ) {
      return targetSource;
    }

    if (
      targetSource &&
      targetSource.fm &&
      typeof targetSource.fm.noteOn === "function" &&
      typeof targetSource.fm.noteOff === "function"
    ) {
      return targetSource.fm;
    }

    throw new Error(
      "MegaSynthLooper requires a synth with noteOn/noteOff or fm.noteOn/fm.noteOff"
    );
  }

  _clonePatch(patch) {
    if (!patch) {
      return null;
    }

    return JSON.parse(
      JSON.stringify(patch)
    );
  }

  _scheduleRecordStopTimer() {
    this._clearRecordStopTimer();

    if (
      !this.recording ||
      !this.currentUnit ||
      this.loopLength === null
    ) {
      return;
    }

    let remainingSeconds =
      this.loopLength -
      this.currentUnit.startedLoopTime;

    if (remainingSeconds <= 0.000001) {
      remainingSeconds =
        this.loopLength;
    }

    this._recordStopTimer =
      this.setTimer(() => {
        this._recordStopTimer = null;

        if (
          !this.running ||
          !this.recording
        ) {
          return;
        }

        this.finishRecording({
          auto: true,
        });
      }, remainingSeconds * 1000);
  }

  _notifyStateChange(
    reason,
    detail = {}
  ) {
    this.onStateChange({
      reason,
      running: this.running,
      recording: this.recording,
      armed: this.armed,
      unit: detail.unit ?? null,
      auto:
        detail.auto === true,
    });
  }

  _unitHasAudio(unit) {
    return !!unit?.audio;
  }

  _rebuildPlaybackChannelMaps() {
    const usedPlaybackChannels = new Set();

    for (const unit of this.units) {
      this._assignPlaybackChannelMap(
        unit,
        usedPlaybackChannels
      );
    }
  }

  _assignPlaybackChannelMap(
    unit,
    usedPlaybackChannels = null
  ) {
    const usedChannels =
      usedPlaybackChannels ??
      this._collectUsedPlaybackChannels(
        unit
      );
    const sourceChannels =
      this._collectUnitChannels(unit);
    const playbackChannelMap = {};

    for (const sourceChannel of sourceChannels) {
      const playbackChannel =
        this._allocatePlaybackChannel(
          sourceChannel,
          usedChannels
        );

      playbackChannelMap[
        String(sourceChannel)
      ] = playbackChannel;
      usedChannels.add(
        playbackChannel
      );
    }

    unit.playbackChannelMap =
      playbackChannelMap;
  }

  _collectUsedPlaybackChannels(
    excludeUnit = null
  ) {
    const usedChannels = new Set();

    for (const unit of this.units) {
      if (unit === excludeUnit) {
        continue;
      }

      for (const playbackChannel of Object.values(
        unit.playbackChannelMap ?? {}
      )) {
        if (
          typeof playbackChannel ===
          "number"
        ) {
          usedChannels.add(
            playbackChannel
          );
        }
      }
    }

    return usedChannels;
  }

  _collectUnitChannels(unit) {
    const channels = [];
    const seen = new Set();

    for (const event of unit.events) {
      if (seen.has(event.channel)) {
        continue;
      }

      seen.add(event.channel);
      channels.push(event.channel);
    }

    return channels;
  }

  _allocatePlaybackChannel(
    preferredChannel,
    usedPlaybackChannels
  ) {
    if (
      !usedPlaybackChannels.has(
        preferredChannel
      )
    ) {
      return preferredChannel;
    }

    for (const channel of ALL_FM_CHANNELS) {
      if (!usedPlaybackChannels.has(channel)) {
        return channel;
      }
    }

    // If all 6 YM2612 channels are already occupied by other looper units,
    // collisions are unavoidable. In that case keep the source channel.
    return preferredChannel;
  }

  _resolvePlaybackChannel(
    sourceChannel,
    playbackChannelMap
  ) {
    if (!playbackChannelMap) {
      return sourceChannel;
    }

    const mappedChannel =
      playbackChannelMap[
        String(sourceChannel)
      ];

    return typeof mappedChannel ===
      "number"
      ? mappedChannel
      : sourceChannel;
  }
}
