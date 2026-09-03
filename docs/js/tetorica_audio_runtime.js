/**
 * Chip-independent browser audio state shared by Tetorica synths.
 *
 * Routing behavior is migrated here incrementally; this first version owns
 * the mutable state so chip synths can compose it without changing callers.
 */
export class TetoricaAudioRuntime {
  constructor(options = {}) {
    this.ownsAudioContext = !options.audioContext;
    this.audioContext = options.audioContext ?? null;
    this.outputNode = options.outputNode ?? null;
    this.sampleOutputNode = options.sampleOutputNode ?? null;
    this.masterVolume = options.masterVolume ?? 1;
    this.masterInputNode = null;
    this.masterOutputNode = null;
    this.fxChain = [];
    this.sampleBuffers = new Map();
    this.sampleVoices = new Set();
    this.streamEntries = new Map();
  }

  ensureRouting(audioContext) {
    this.audioContext = audioContext;
    if (!this.masterInputNode) this.masterInputNode = audioContext.createGain();
    if (!this.masterOutputNode) {
      this.masterOutputNode = audioContext.createGain();
      this.masterOutputNode.gain.value = this.masterVolume;
    }
    this.rebuildFXChain();
  }

  connectChipOutput(node) {
    if (!node || !this.masterInputNode) throw new Error("Audio routing is not ready");
    node.connect(this.masterInputNode);
  }

  setFXChain(effects = [], options = {}) {
    if (!Array.isArray(effects)) throw new Error("FX chain must be an array");
    const previous = this.fxChain.slice();
    this.fxChain = effects.slice();
    this.rebuildFXChain();
    if (options.dispose) previous.forEach((effect) => effect?.dispose?.());
  }

  getFXChain() { return this.fxChain.slice(); }

  connect(effect) {
    this.fxChain.push(effect);
    this.rebuildFXChain();
  }

  clearFXChain(options = {}) {
    const previous = this.fxChain.slice();
    this.fxChain = [];
    this.rebuildFXChain();
    if (options.dispose) previous.forEach((effect) => effect?.dispose?.());
    return previous;
  }

  connectOutput(node = null) {
    this.outputNode = node ?? this.outputNode ?? this.audioContext?.destination ?? null;
    this.rebuildFXChain();
  }

  setMasterVolume(volume) {
    this.masterVolume = volume;
    if (this.masterOutputNode) this.masterOutputNode.gain.value = volume;
    return volume;
  }

  rebuildFXChain() {
    if (!this.masterInputNode || !this.masterOutputNode) return;
    this.masterInputNode.disconnect();
    this.masterOutputNode.disconnect();
    this.fxChain.forEach((effect) => effect?.disconnect?.());
    let current = this.masterInputNode;
    for (const effect of this.fxChain) {
      if (!effect?.input || !effect?.output) throw new Error("Each FX unit must expose input and output nodes");
      current.connect(effect.input);
      current = effect.output;
    }
    const target = this.outputNode ?? this.audioContext?.destination;
    if (target) {
      current.connect(this.masterOutputNode);
      this.masterOutputNode.connect(target);
    }
  }
}
