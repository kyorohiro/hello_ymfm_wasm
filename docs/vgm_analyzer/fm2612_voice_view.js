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

const parameters = ['dt', 'multi', 'tl', 'rs', 'ar', 'am', 'd1r', 'd2r', 'sl', 'rr', 'ssg'];

export function mountFm2612VoiceView(root, openInstrument) {
  const selector = root.querySelector('[data-fm-channels]');
  const routing = root.querySelector('[data-fm-routing]');
  const feedback = root.querySelector('[data-fm-feedback]');
  const open = root.querySelector('[data-fm-open]');
  const details = root.querySelector('details');
  const table = root.querySelector('table');
  let channels = [];
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
  for (const name of ['OP', ...parameters]) {
    const th = document.createElement('th');
    th.scope = 'col'; th.textContent = name.toUpperCase(); header.append(th);
  }
  const body = table.createTBody();
  const rows = [1,2,3,4].map(op => {
    const row = body.insertRow();
    const th = document.createElement('th');
    th.scope = 'row'; th.textContent = 'OP' + op; row.append(th);
    return parameters.map(() => row.insertCell());
  });
  function refresh() {
    const channel = channels[index];
    root.hidden = !channel;
    view.setVisible(Boolean(channel));
    if (!channel) return;
    for (const [i, button] of buttons.entries()) button.setAttribute('aria-pressed', String(i === index));
    routing.textContent = routes[channel.algorithm];
    feedback.textContent = 'Feedback ' + channel.feedback;
    const dac = index === 5 && channel.dacEnabled;
    open.disabled = dac;
    open.title = dac ? 'CH6 is playing DAC samples' : '';
    for (const [i, cells] of rows.entries()) {
      for (const [j, cell] of cells.entries()) {
        const value = String(channel.operators[i+1][parameters[j]]);
        if (cell.textContent !== value) cell.textContent = value;
      }
    }
    view.invalidate();
  }
  open.onclick = () => {if (channels[index] && !open.disabled) openInstrument(channels[index]);};
  return {
    update(next) {channels = next; refresh();},
    dispose() {view.dispose();},
  };
}
