/** DOS PC register authoring stays in JS; the selected OPL renders in Native. */
import {OPLSynth} from './opl_synth.js?v=audio-numeric-bindings-1';
import {OplVoiceInspector} from './playground_opl_inspector.js?v=native-extra-spc-1';
import {validateChipClock} from './playground_chip_clock.js?v=audio-numeric-bindings-1';
import {createNativeVoiceContext, createNativeVoiceEndpoint, nativeInteger as integer,
  nativeSnapshotArray} from './native_genesis_voice_endpoint.js?v=native-extra-spc-1';

const CHIPS = Object.freeze(['ym3526', 'ym3812', 'ymf262']);
const PAIRS = [0, 1, 2, 9, 10, 11];

export function createNativeGenesisOpl(synth, {chip = 'ym3812', msxAudio = false} = {}) {
  if (!CHIPS.includes(chip) && !(msxAudio && chip === 'y8950')) throw new RangeError('Native DOS PC requires YM3526, YM3812 or YMF262');
  const baseClock = chip === 'ymf262' ? 14318180 : 3579545;
  const channels = chip === 'ymf262' ? 18 : 9;
  const registerCount = chip === 'ymf262' ? 512 : 256;
  const context = createNativeVoiceContext(synth, {
    backend: 'opl', statusCommand: 'native_genesis_opl_status', label: chip === 'y8950' ? 'MSX Audio Y8950' : 'DOS PC OPL',
  });
  let clock = baseClock, appliedClock = baseClock, initialized = false;
  let layout = [0, 0, 0], notification = null;
  const notifyLayout = () => {
    if (notification) return;
    let token;
    try { token = context.capture(); } catch { return; }
    notification = token;
    queueMicrotask(() => {
      if (notification !== token) return;
      notification = null;
      try {
        context.current(token);
        if (context.isEnabled(chip)) synth.emit?.({type: 'native-state', name: 'opl', state: client._getState()});
      } catch { /* A retired session must not publish its old layout. */ }
    });
  };
  const observeLayout = (register, value) => {
    const index = register === 0x104 ? 0 : register === 0x105 ? 1 : register === 0xbd ? 2 : -1;
    if (index < 0) return;
    const bits = value & [63, 1, 32][index];
    if (layout[index] !== bits) { layout[index] = bits; notifyLayout(); }
  };
  const client = new OPLSynth({chip, clock, transport: {
    writeRegister(register, value, bank = 0) {
      const address = register | (bank << 8);
      context.send(chip, {method: 'write', register: address, value});
      observeLayout(address, value);
    },
    reset() {
      context.send(chip, {method: 'reset'});
      if (layout.some(Boolean)) { layout = [0, 0, 0]; notifyLayout(); }
    },
  }});
  Object.defineProperties(client, {
    id: {value: chip, enumerable: true},
    clock: {configurable: true, enumerable: true, get: () => clock},
  });
  client.dispose = () => {};
  client._adoptClock = hz => { clock = validateChipClock(hz); };
  client._getState = () => ({chip, clock, initialized, registers: Array.from(client.getRegisterSnapshot())});
  client._adoptState = state => {
    if (state?.registers) {
      client.adoptRegisterSnapshot(state.registers);
      for (const address of [0x104, 0x105, 0xbd]) observeLayout(address, state.registers[address] ?? 0);
    }
    if (state?.clock !== undefined) client._adoptClock(state.clock);
    if (state?.initialized !== undefined) initialized = !!state.initialized;
  };
  const initialize = client.initialize.bind(client);
  client.initialize = () => { const result = initialize(); initialized = true; return result; };
  client._forceKeyOff = channel => {
    integer(channel, channels - 1, 'OPL channel');
    const registers = client.getRegisterSnapshot();
    const address = (channel >= 9 ? 256 : 0) + 0xb0 + channel % 9;
    registers[address] &= 223;
    if (client.isFourOp(channel)) registers[address + 3] &= 223;
    client.adoptRegisterSnapshot(registers);
    context.send(chip, {method: 'key-off', channel});
  };
  client._forceRhythmOff = drum => {
    integer(drum, 4, 'OPL drum');
    const registers = client.getRegisterSnapshot();
    registers[0xbd] &= ~(16 >> drum);
    client.adoptRegisterSnapshot(registers);
    context.send(chip, {method: 'key-off', channel: 18 + drum});
  };
  const inspector = new OplVoiceInspector({chip, clock: () => appliedClock, sampleRate: synth.clock.sampleRate});
  function adopt(data, adoptClient, leases) {
    nativeSnapshotArray(data.registers, registerCount, 255, chip.toUpperCase());
    context.validateHeld(data, 22);
    appliedClock = validateChipClock(data.clock);
    inspector.registers.set(data.registers);
    inspector.sampleRate = data.sampleRate ?? synth.clock.sampleRate;
    if (adoptClient) client._adoptState(data);
    return {...data, ...inspector.read(), held: data.held ?? [...leases.keys()]};
  }
  function translate(message) {
    const args = message.args ?? [], method = message.method ?? message.type;
    if (!Array.isArray(args)) throw new TypeError('DOS PC OPL arguments must be an array');
    if (method === 'writeRegister') {
      const register = integer(args[0], registerCount - 1, 'Register');
      const value = integer(args[1], 255, 'Value');
      const bank = integer(args[2] ?? 0, chip === 'ymf262' ? 1 : 0, 'Bank');
      if (register > 255 && bank !== 0) throw new RangeError('Use a flattened register or a bank, not both');
      return {method: 'write', register: register | (bank << 8), value};
    }
    if (method === 'forceKeyOff') return {method: 'key-off', channel: integer(args[0], channels - 1, 'Channel')};
    if (method === 'forceRhythmOff') return {method: 'key-off', channel: 18 + integer(args[0], 4, 'Drum')};
    if (method === 'auditionKeyOn') return {method: 'audition-key-on', channel: integer(args[0], channels - 1, 'Channel')};
    if (method === 'clock') return {method: 'clock', hz: validateChipClock(args[0])};
    if (method === 'reset' || method === 'resetAll') return {method: 'reset'};
    if (method === 'stopVoices' || method === 'allNotesOff') return {method: 'stop-voices'};
    throw new Error(`Unsupported Native ${chip} operation: ${method}`);
  }
  function patch(groups) {
    const state = client._getState();
    const pair = channel => {
      const bit = PAIRS.indexOf(channel);
      return bit >= 0 && (state.registers[0x104] & (1 << bit)) ? [channel, channel + 3] : [channel];
    };
    for (const group of groups) for (const command of group.commands) {
      if (command.method === 'write') state.registers[command.register] = command.value;
      if (command.method === 'key-off') {
        if (command.channel >= 18) state.registers[0xbd] &= ~(16 >> (command.channel - 18));
        else for (const ch of pair(command.channel)) state.registers[(ch >= 9 ? 256 : 0) + 0xb0 + ch % 9] &= 223;
      }
      if (command.method === 'audition-key-on') state.registers[(command.channel >= 9 ? 256 : 0) + 0xb0 + command.channel % 9] |= 32;
      if (command.method === 'reset') state.registers.fill(0);
    }
    client._adoptState(state);
  }
  const endpoint = createNativeVoiceEndpoint(context, {
    chip, globalName: 'opl', client, inspector, translate, adopt, patch,
    reset() {
      initialized = false;
      appliedClock = baseClock;
      client._adoptState({chip, clock: baseClock, initialized: false, registers: Array(registerCount).fill(0)});
    },
  });
  // A clock acknowledgement means that its scheduled frame has applied, just
  // as it does in the Web Worklet. Native IPC admission alone is insufficient:
  // a manual audition can take the chip between submission and that frame.
  const dispatch = endpoint.dispatch;
  let clocks = Promise.resolve();
  endpoint.dispatch = (message, timing = {}) => {
    if ((message.method ?? message.type) !== 'clock') return dispatch(message, timing);
    let token, hz;
    try {
      token = context.capture();
      timing.checkCurrent?.();
      hz = translate(message).hz;
    } catch (error) { return Promise.reject(error); }
    const result = clocks.then(async () => {
      context.current(token);
      timing.checkCurrent?.();
      // Keep a rejected clock control separate from ordinary note/patch writes.
      // Only this isolated, acknowledged control has a recoverable held error.
      await synth.flush();
      context.current(token);
      timing.checkCurrent?.();
      const id = context.identity();
      context.send(chip, {method: 'clock', hz, id}, timing);
      await synth.flush();
      context.current(token);
      timing.checkCurrent?.();
      const state = await context.snapshot(chip, {after: id});
      context.current(token);
      timing.checkCurrent?.();
      if (validateChipClock(state.clock) !== hz) throw new Error('Native OPL clock was not applied; the chip may be held by a manual audition');
      client._adoptClock(hz);
      synth.emit?.({type: 'native-state', name: 'opl', state: client._getState()});
      return message.id === undefined ? undefined : {id: message.id};
    });
    clocks = result.catch(() => {});
    return result;
  };
  client.setClock = hz => endpoint.dispatch({method: 'clock', args: [hz]});
  client._stopVoices = () => {
    const registers = client.getRegisterSnapshot();
    for (let channel = 0; channel < channels; channel++) registers[(channel >= 9 ? 256 : 0) + 0xb0 + channel % 9] &= 223;
    registers[0xbd] &= 224;
    client.adoptRegisterSnapshot(registers);
    return endpoint.dispatch({method: 'stopVoices'});
  };
  client.readStatus = async () => (await endpoint.read()).status;
  client.getIrq = async () => !!(await endpoint.read()).irq;
  return endpoint;
}
