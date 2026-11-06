/** Read-only applied state. Inspection does not use hardware bus reads or clock
 * the chip; keyboard audition/edit RPCs remain unsupported in this milestone. */
export class SidVoiceInspector {
  constructor({synth, sampleRate} = {}) { this.synth = synth; this.sampleRate = sampleRate; }
  read() {
    const state = this.synth._getState();
    return {...state, kind: 'sid', sampleRate: this.sampleRate, readOnly: true, activeSource: 'applied-register-gates',
      channels: state.channels.map((voice, channel) => ({...voice, channel, active: voice.gate && !voice.test}))};
  }
  invoke() { throw new Error('SID inspector is read-only; use the sid API to edit voices'); }
}

/** Keep the common inspector message protocol without pulling unrelated chip
 * editors into the standalone SID source kit. No operation clocks the core. */
export function receiveSidInspector(data, port, inspector) {
  if (data?.type !== 'chip-inspector') return false;
  try {
    if (!inspector) throw new Error('SID is not ready');
    if (data.action !== 'read') throw new Error('SID inspector is read-only; unsupported action');
    port.postMessage({type: 'chip-inspector-result', id: data.id, value: inspector.read()});
  } catch (error) { port.postMessage({type: 'chip-inspector-result', id: data.id, error: error.message}); }
  return true;
}
