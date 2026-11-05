// SPDX-License-Identifier: BSD-3-Clause
import {hardwareStateModel} from './hardware_state.js';

/** Passive display of sampled chip state. It never edits the instrument. */
export function createHardwareMonitor({root}) {
  const doc = root.ownerDocument;
  const make = (tag, className, text) => {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const heading = make('div', 'nes-hardware-heading');
  const title = make('h3', '', 'Hardware now'); title.id = 'hardwareMonitorHeading';
  const status = make('span', '', 'Enable audio, then play a key.'); status.id = 'hardwareMonitorStatus';
  heading.append(title, status);
  const channels = make('div', 'nes-hardware-channels');
  const description = make('p', 'nes-help', 'Software observation · about 10 updates per second.');
  const note = make('p', 'nes-help'); note.id = 'hardwareMonitorNote';
  root.classList.add('nes-hardware-monitor'); root.setAttribute('aria-labelledby', title.id);
  root.append(heading, channels, note, description);
  const rows = new Map();
  let source, state = null, mode = 'waiting', disposed = false;
  function render() {
    if (disposed) return;
    const model = hardwareStateModel(state, source);
    for (const channel of model.channels) {
      const row = rows.get(channel.id); row.status.textContent = channel.status;
      row.root.dataset.status = channel.status;
      for (const metric of channel.metrics) {
        const view = row.metrics.get(metric.id), available = metric.value !== null;
        view.value.textContent = metric.text;
        view.meter.dataset.available = String(available);
        if (available) {
          view.meter.setAttribute('role', 'meter');
          view.meter.removeAttribute('aria-label');
          view.meter.setAttribute('aria-labelledby', view.label.id);
          view.meter.setAttribute('aria-valuemin', '0');
          view.meter.setAttribute('aria-valuemax', String(metric.max));
          view.meter.setAttribute('aria-valuenow', String(metric.value));
          view.meter.setAttribute('aria-valuetext', metric.text);
        } else {
          view.meter.setAttribute('role', 'img');
          view.meter.removeAttribute('aria-labelledby');
          view.meter.setAttribute('aria-label', `${metric.label}: not sampled`);
          view.meter.removeAttribute('aria-valuemin');
          view.meter.removeAttribute('aria-valuemax');
          view.meter.removeAttribute('aria-valuenow');
          view.meter.removeAttribute('aria-valuetext');
        }
        view.fill.style.width = `${available ? metric.value / metric.max * 100 : 0}%`;
      }
    }
    note.textContent = model.note;
  }
  function setSource(value) {
    if (disposed || source === value) return;
    source = value; state = null; root.dataset.source = source;
    channels.replaceChildren(); rows.clear();
    for (const channel of hardwareStateModel(null, source).channels) {
      const row = make('div', 'nes-hardware-channel'), heading = make('div', 'nes-hardware-channel-heading');
      const label = make('h4', '', channel.label), status = make('span'); heading.append(label, status); row.append(heading);
      const metrics = new Map();
      for (const metric of channel.metrics) {
        const key = `${channel.id}-${metric.id}`, line = make('div', 'nes-hardware-metric');
        const label = make('span', 'nes-hardware-label', metric.label); label.id = `hardware-${key}`;
        const meter = make('div', 'nes-hardware-meter'); meter.dataset.hardwareMeter = key;
        meter.setAttribute('role', 'meter'); meter.setAttribute('aria-labelledby', label.id); meter.setAttribute('aria-valuemin', '0');
        const fill = make('span'); meter.append(fill);
        const value = make('span', 'nes-hardware-value', '—'); value.dataset.hardwareValue = key;
        line.append(label, meter, value); row.append(line); metrics.set(metric.id, {label,meter,fill,value});
      }
      channels.append(row); rows.set(channel.id, {root:row,status,metrics});
    }
    render();
  }
  function setMode(value) {
    if (disposed) return;
    mode = value; root.dataset.mode = mode;
    const text = {waiting:'Enable audio, then play a key.',live:'Live · sampled chip state',idle:'Idle · play a key to observe.',paused:'Paused · observation stopped.',unavailable:'Observation unavailable · release all keys, then play to retry.'};
    status.textContent = source === 'dmc' ? 'DMC · see the DAC preview below.' : text[mode] ?? text.waiting;
    if (mode !== 'live') {state = null; render();}
  }
  setSource('pulse'); setMode('waiting');
  return {
    setSource, setMode,
    update(value) {if (disposed || value?.preset?.source !== source) return; state = value; setMode('live'); render();},
    dispose() {if (disposed) return; disposed = true; rows.clear(); root.replaceChildren();},
  };
}
