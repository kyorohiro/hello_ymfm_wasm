/** Opt-in observation only: four Main-allocated PCM buffers, one final transfer.
 * Inputs are chip stereo and final mixed stereo. The output is always silent;
 * neither audible routing nor chip state is modified by this processor.
 */
const MAX_FRAMES = 2 ** 21; // Four Float32 channels: at most 32 MiB.

class AudioDiagnosticCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = null;
    this.id = null;
    this.frames = this.capacity = this.blocks = this.frameGaps = 0;
    this.firstFrame = this.lastFrame = null;
    this.missingInputFrames = [0, 0];
    this.startedAtWallMs = this.lastWallMs = null;
    this.maxWallGapMs = this.maxProcessMs = this.clockBacksteps = 0;
    this.port.onmessage = ({data}) => {
      try {
        if (data?.type === 'arm') this.arm(data);
        else if (data?.id === this.id && data.type === 'stop') this.finish('stopped');
        else if (data?.id === this.id && data.type === 'cancel') this.channels = null;
      } catch (error) {
        this.port.postMessage({type:'error', id:data?.id, error:error.message});
      }
    };
  }

  arm({id, channels}) {
    if (this.channels) throw new Error('Audio capture is already active');
    if (!Number.isSafeInteger(id) || id < 1 || !Array.isArray(channels) || channels.length !== 4) {
      throw new Error('Invalid audio capture request');
    }
    const length = channels[0]?.length;
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_FRAMES) {
      throw new Error('Invalid audio capture capacity');
    }
    for (let ch = 0; ch < 4; ch++) {
      if (!(channels[ch] instanceof Float32Array) || channels[ch].length !== length ||
          !(channels[ch].buffer instanceof ArrayBuffer)) throw new Error('Invalid audio capture buffer');
      for (let previous = 0; previous < ch; previous++) {
        if (channels[ch].buffer === channels[previous].buffer) throw new Error('Audio capture buffers must be independent');
      }
    }
    this.channels = channels;
    this.id = id;
    this.capacity = length;
    this.frames = this.blocks = this.frameGaps = 0;
    this.firstFrame = this.lastFrame = null;
    this.missingInputFrames[0] = this.missingInputFrames[1] = 0;
    this.startedAtWallMs = this.lastWallMs = null;
    this.maxWallGapMs = this.maxProcessMs = this.clockBacksteps = 0;
    this.port.postMessage({type:'armed', id});
  }

  finish(reason) {
    const channels = this.channels;
    if (!channels) return;
    this.channels = null;
    this.port.postMessage({type:'result', id:this.id, channels, frames:this.frames,
      sampleRate, firstFrame:this.firstFrame, lastFrame:this.lastFrame,
      blocks:this.blocks, frameGaps:this.frameGaps, missingInputFrames:this.missingInputFrames,
      startedAtWallMs:this.startedAtWallMs, maxWallGapMs:this.maxWallGapMs,
      maxProcessMs:this.maxProcessMs, clockBacksteps:this.clockBacksteps, reason},
    [channels[0].buffer, channels[1].buffer, channels[2].buffer, channels[3].buffer]);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (output) for (let ch = 0; ch < output.length; ch++) output[ch].fill(0);
    const channels = this.channels;
    if (!channels) return true;
    const wall = Date.now();
    if (this.startedAtWallMs === null) this.startedAtWallMs = wall;
    if (this.lastWallMs !== null) {
      const gap = wall - this.lastWallMs;
      if (gap < 0) this.clockBacksteps++;
      else this.maxWallGapMs = Math.max(this.maxWallGapMs, gap);
    }
    this.lastWallMs = wall;
    const quantum = output?.[0]?.length ?? inputs[0]?.[0]?.length ?? 128;
    const count = Math.min(quantum, this.capacity - this.frames);
    if (this.firstFrame === null) this.firstFrame = currentFrame;
    if (this.lastFrame !== null && this.lastFrame !== currentFrame) this.frameGaps++;
    for (let input = 0; input < 2; input++) {
      const source = inputs[input];
      this.missingInputFrames[input] += count - Math.min(count, source?.[0]?.length ?? 0);
      for (let ch = 0; ch < 2; ch++) {
        const from = source?.[ch] ?? source?.[0], to = channels[input * 2 + ch];
        const copied = Math.min(count, from?.length ?? 0);
        if (from && copied === from.length) to.set(from, this.frames);
        else for (let i = 0; i < copied; i++) to[this.frames + i] = from[i];
        if (copied < count) to.fill(0, this.frames + copied, this.frames + count);
      }
    }
    this.frames += count;
    this.lastFrame = currentFrame + count;
    this.blocks++;
    const elapsed = Date.now() - wall;
    if (elapsed < 0) this.clockBacksteps++;
    else this.maxProcessMs = Math.max(this.maxProcessMs, elapsed);
    if (this.frames === this.capacity) this.finish('complete');
    return true;
  }
}

registerProcessor('tetorica-audio-diagnostic', AudioDiagnosticCapture);
