import {createOperatorEnvelopeView} from '../synth/synth_operator_envelope.js';

const routes = [
  'ALGO 0 OP1 → OP2 → OP3 → OP4 → OUT',
  'ALGO 1 (OP1 + OP2) → OP3 → OP4 → OUT',
  'ALGO 2 (OP1 + (OP2 → OP3)) → OP4 → OUT',
  'ALGO 3 ((OP1 → OP2) + OP3) → OP4 → OUT',
  'ALGO 4 (OP1 → OP2) + (OP3 → OP4) → OUT',
  'ALGO 5 (OP1 → OP2) + (OP1 → OP3) + (OP1 → OP4) → OUT',
  'ALGO 6 (OP1 → OP2) + OP3 + OP4 → OUT',
  'ALGO 7 OP1 + OP2 + OP3 + OP4 → OUT',
];

// Bits 0–3 identify the operators mixed directly into the channel output.
const carrierMasks = [8, 8, 8, 8, 10, 14, 14, 15];
const parameters = ['dt', 'multi', 'tl', 'rs', 'ar', 'am', 'd1r', 'd2r', 'sl', 'rr', 'ssg'];

export function mountFm2612VoiceView(root, openInstrument) {
  const selector = root.querySelector('[data-fm-channels]');
  const routing = root.querySelector('[data-fm-routing]');
  const feedback = root.querySelector('[data-fm-feedback]');
  const open = root.querySelector('[data-fm-open]');
  const details = root.querySelector('details');
  const table = root.querySelector('table');
  const status = root.querySelector('[data-fm-status]');
  const readouts = new Map();
  function showStatus(label, value, highlight) {
    let span = readouts.get(label);
    if (!span) {
      span = document.createElement('span');
      span.className = 'channel-chip';
      status.append(span);
      readouts.set(label, span);
    }
    span.hidden = value === null;
    if (!span.hidden) paint(span, label + ' ' + value, highlight);
  }
  let channels = [];
  let chip;
  let previousChannel;
  function paint(node, value, highlight) {
    const text = String(value);
    if (node.textContent === text) return;
    node.textContent = text;
    if (highlight && !root.closest('[hidden]')) {
      for (const animation of node.getAnimations()) animation.cancel();
      node.animate([{backgroundColor:'#ffcb79'}, {backgroundColor:'transparent'}], 750);
    }
  }
  let index = 0;
  const view = createOperatorEnvelopeView({root:details, getOperators:() => channels[index].operators});
  const buttons = Array.from({length:6}, (_, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'CH' + (i + 1);
    button.onclick = () => {index = i; refresh();};
    selector.append(button);
    return button;
  });
  const header = table.createTHead().insertRow();
  const columns = ['OP', ...parameters, 'Key', 'Role', 'Block', 'FNUM'];
  for (const name of columns) {
    const th = document.createElement('th');
    th.scope = 'col'; th.textContent = name.toUpperCase(); header.append(th);
  }
  const body = table.createTBody();
  const rows = [1,2,3,4].map(op => {
    const row = body.insertRow();
    const th = document.createElement('th');
    th.scope = 'row'; th.textContent = 'OP' + op; row.append(th);
    return columns.slice(1).map(() => row.insertCell());
  });
  function refresh() {
    const channel = channels[index];
    root.hidden = !channel;
    view.setVisible(Boolean(channel));
    if (!channel) {previousChannel = null; return;}
    const highlight = channel === previousChannel;
    previousChannel = channel;
    for (const [i, button] of buttons.entries()) {
      const ch = channels[i];
      button.hidden = !ch || ch.unavailable;
      button.setAttribute('aria-pressed', String(i === index));
      button.classList.toggle('is-key-on', Boolean(ch?.keyOn));
      button.title = ch?.keyOn ? 'Key on' : 'Key off';
    }
    paint(routing, routes[channel.algorithm], highlight);
    paint(feedback, 'Feedback ' + channel.feedback, highlight);
    const stereo = chip !== 'ym2203';
    const dacChannel = chip === 'ym2612' && index === 5;
    const ch3 = index === 2;
    const mode = [channel.specialMode && '3-slot', channel.csm && 'CSM'].filter(Boolean).join(' + ') || 'Normal';
    const pan = (channel.panLeft ? 'L' : '–') + (channel.panRight ? 'R' : '–');
    showStatus('Block', channel.block, highlight);
    showStatus('FNUM', channel.fnum, highlight);
    showStatus('Pan', stereo ? pan : null, highlight);
    showStatus('AMS', stereo ? (channel.b4Value >> 4) & 3 : null, highlight);
    showStatus('PMS', stereo ? channel.b4Value & 7 : null, highlight);
    showStatus('LFO', stereo ? (channel.lfo & 8 ? 'On' : 'Off') : null, highlight);
    showStatus('LFO rate', stereo ? channel.lfo & 7 : null, highlight);
    showStatus('CH3 mode', ch3 ? mode : null, highlight);
    showStatus('DAC', dacChannel ? (channel.dacEnabled ? 'On' : 'Off') : null, highlight);
    showStatus('DAC byte', dacChannel ? channel.dacValue : null, highlight);
    open.disabled = dacChannel && channel.dacEnabled;
    open.title = open.disabled ? 'CH6 is playing DAC samples' : '';
    const pitchColumns = columns.length - 2;
    for (let j = 0; j < columns.length; j++) {
      header.cells[j].hidden = (j >= pitchColumns && !ch3) || (columns[j] === 'am' && !stereo);
    }
    const carriers = carrierMasks[channel.algorithm];
    for (const [i, cells] of rows.entries()) {
      const op = channel.operators[i+1];
      const pitch = i < 3 && (channel.specialMode || channel.csm) ? channel.specialFrequencies[i+1] : channel;
      const opValues = [...parameters.map(key => op[key]), channel.keyMask & (1 << i) ? 'On' : 'Off',
        carriers & (1 << i) ? 'Carrier' : 'Modulator', pitch.block, pitch.fnum];
      cells.forEach((cell,j) => {
        cell.hidden = header.cells[j+1].hidden;
        if (!cell.hidden) paint(cell, opValues[j], highlight);
      });
    }
    view.invalidate();
  }
  open.onclick = () => {if (channels[index] && !open.disabled) openInstrument(channels[index]);};
  return {
    update(next, kind) {
      channels = next;
      chip = kind;
      if (!channels[index] || channels[index].unavailable) index = Math.max(0, channels.findIndex(ch => !ch.unavailable));
      refresh();
    },
    dispose() {view.dispose();},
  };
}

// OPM register slots are M1/C1/M2/C2, while the envelope legend uses OP1–4.
export function mountOpmEnvelope(root) {
  const details = document.createElement('details');
  details.open = false;
  details.innerHTML = '<summary>Envelope</summary><canvas data-operator-envelope height="128" role="img" aria-label="Relative YM2151 envelope settings for OP1 through OP4"></canvas>';
  root.append(details);
  const routing=document.createElement('p');root.append(routing);
  let current;
  const view = createOperatorEnvelopeView({root:details, getOperators() {
    return Object.fromEntries([0,2,1,3].map((slot,i) => {
      const op = current.operators[slot];
      return [i+1,{dt:op.dt1, tl:op.tl, ar:op.ar, d1r:op.d1r, d2r:op.d2r, sl:op.d1l, rr:op.rr}];
    }));
  }});
  return {
    update(channel) {
      current=channel;
      if(routing.textContent!==routes[channel.algorithm])routing.textContent=routes[channel.algorithm];
      view.setVisible(true);
      view.invalidate();
    },
    dispose() {view.dispose();},
  };
}
