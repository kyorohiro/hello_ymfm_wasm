import {createHash} from 'node:crypto';

export const historicalYm2612SynthSha256 = '7375b502f5fb2b0bf93fca1be51868dab47d866ecd4879a744ba9bb7ad26d1cb';
const addedSource = [
  "import {createYm2612OperationResetState, validateYm2612OperationState, observeYm2612OperationWrite} from './ym2612_operation_state.js';\n",
  "    this._timedState = createYm2612OperationResetState();\n    this._timedClientStateComplete = typeof this.transport.reset === 'function';\n",
  '    observeYm2612OperationWrite(this._timedState, port, register, value);\n',
  '    for (const command of commands) observeYm2612OperationWrite(this._timedState, command.port, command.register, command.value);\n',
  "\n  _releaseTimedNotes() {\n    if (!this.disposed) this.node.port.postMessage({type:'release-timed-notes'});\n  }\n",
  '  // Private compilation baseline. The ordinary getState() UI shape is unchanged.\n' +
  '  _getTimedState() { return validateYm2612OperationState(this._timedState); }\n' +
  '  _adoptTimedState(state) {\n' +
  '    this._timedState = validateYm2612OperationState(state);\n' +
  '    this._timedClientStateComplete = true;\n' +
  '  }\n' +
  '  _invalidateTimedState() { this._timedClientStateComplete = false; }\n\n',
];

/** Remove only this reviewed additive shadow revision, then authenticate every
 * remaining byte against the measured d620c38f source. No git history is needed
 * in CI; unrelated edits cannot silently become the historical baseline. */
export function restoreHistoricalYm2612TimedSynth(source) {
  source = source.replace('    const held = this._timedState.keyMasks[channel] << 4;\n    this._write(0, 0x28, (held & ~operatorMask) | KEY_CHANNEL_CODES[channel]);',
    '    this._write(0, 0x28, operatorMask | KEY_CHANNEL_CODES[channel]);');
  for (const added of addedSource) {
    if (source.split(added).length !== 2) throw new Error('YM2612 timed Synth source revision changed');
    source = source.replace(added, '');
  }
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== historicalYm2612SynthSha256) throw new Error('YM2612 predecessor source authentication failed');
  return source;
}

/** Exact register/hook/state exercise shared by regression and proof output. */
export function ym2612ImmediateCompatibilityTrace(Type) {
  const trace = [];
  const synth = new Type({clock: 7670454, transport: {
    reset() { trace.push({type: 'reset'}); },
    write(port, register, value) { trace.push({type: 'write', port, register, value}); },
    writeBatch(rows) { trace.push({type: 'batch', rows}); },
    getIrq() { return false; }, read(offset) { return offset + 3; }, readStatus() { return 4; },
  }});
  synth.setHooks({onWrite: write => trace.push({type: 'hook', ...write}),
    onIrq: value => trace.push({type: 'irq', value})});
  for (let ch = 0; ch < 6; ch++) {
    synth.setPreset(ch, {algorithm: ch % 8, feedback: ch % 8,
      pan: {left: ch % 2 === 0, right: true}, ams: ch % 4, pms: ch % 8,
      operators: Array.from({length: 4}, (_, op) => ({dt: op, multi: op + 1, tl: ch * 7 + op,
        rs: op % 4, ar: 31 - op, am: !!(op % 2), d1r: 12 + op,
        d2r: 3 + op, sl: op, rr: 4 + op, ssg: op}))});
    synth.setOperators(ch, [[1, {multi: 7}], [1, {tl: 11}], [3, {ar: 18, rr: 9}]]);
    synth.setPan(ch, true, true);
    synth.setFrequency(ch, 110 * (ch + 1));
    synth.noteOn(ch, 'E3');
    synth.keyOn(ch, [0, 2]);
    synth.keyOff(ch, [1, 3]);
    synth.noteOff(ch);
  }
  synth.setLfo(true, 5);
  synth.setChannel3SpecialMode(true);
  for (let op = 0; op < 4; op++) synth.setChannel3SpecialFrequency(op, op, 257 + op);
  synth.write(0, 0xa4, 0x35);
  synth.write(1, 0xa1, 0x79);
  synth.rawWrite(0, 0xac, 0x2a);
  synth.writeAddress(1, 0x38);
  synth.writeData(0x52);
  synth.setDacEnabled(true);
  synth.writeDac(0x70);
  synth.setDacEnabled(false);
  trace.push({type: 'state', value: synth.getState()});
  synth.reset();
  trace.push({type: 'reset-state', value: synth.getState()});
  return trace;
}
