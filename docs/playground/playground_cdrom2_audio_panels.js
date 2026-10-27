/** Read-only CD-ROM² playback snapshots. Opening/refreshing never creates an
 * audio source. The host reads an existing endpoint; no polling or audio writes.
 */
const KINDS = ['msm5205', 'cdda'];
const number = value => Number.isFinite(value) && value >= 0 ? value.toLocaleString('en-US', {maximumFractionDigits: 2}) : '—';
const integer = value => Number.isSafeInteger(value) && value >= 0 ? number(value) : '—';
const seconds = value => Number.isFinite(value) && value >= 0 ? `${value.toFixed(3)} s` : '—';
const states = {ready:'Ready', empty:'Empty', playing:'Playing', paused:'Paused', ended:'Ended'};

/** @param {{roots:Partial<Record<'msm5205'|'cdda',HTMLElement>>,
 * readState:(kind:'msm5205'|'cdda')=>unknown|Promise<unknown>,onError?:(error:unknown)=>void}} options
 */
export function createPlaygroundCdrom2AudioPanels({roots, readState, onError = () => {}}) {
  if (!roots || typeof readState !== 'function') throw new TypeError('CD-ROM² panels require roots and readState');
  const panels = new Map(), listeners = [];
  let active = null, generation = 0, pending = null, disposed = false;
  const listen = (node, type, handler) => {
    node.addEventListener(type, handler); listeners.push(() => node.removeEventListener(type, handler));
  };
  for (const kind of KINDS) {
    const root = roots[kind]; if (!root) continue;
    const doc = root.ownerDocument;
    const make = (tag, className, text) => {
      const node = doc.createElement(tag); if (className) node.className = className;
      if (text !== undefined) node.textContent = text; return node;
    };
    const container = make('div', 'chip-editor'); container.dataset.cdrom2Audio = kind;
    const toolbar = make('div', 'chip-editor-toolbar'), refreshButton = make('button', '', 'Refresh');
    refreshButton.type = 'button'; refreshButton.dataset.cdrom2Action = 'refresh';
    refreshButton.setAttribute('aria-label', `Refresh ${kind === 'cdda' ? 'CD-DA' : 'MSM5205'} playback state`);
    toolbar.appendChild(refreshButton); container.appendChild(toolbar);
    const body = make('div', 'chip-editor-body'), section = make('section', 'chip-section');
    section.appendChild(make('h3', '', kind === 'msm5205' ? 'MSM5205 · ADPCM' : 'CD-DA · Audio tracks'));
    section.appendChild(make('p', 'subtext', kind === 'msm5205'
      ? 'Mono · 4-bit OKI ADPCM · 64 KiB sample RAM · 1.536 MHz clock'
      : '44,100 Hz · 16-bit stereo PCM · 2 channels'));
    const fields = make('div', 'chip-fields'), outputs = new Map();
    function output(label, name) {
      const field = make('label', 'chip-field'), value = make('output', '', '—');
      field.style.maxWidth = '100%'; value.style.overflowWrap = 'anywhere';
      value.dataset.cdrom2Output = name; value.setAttribute('aria-label', label);
      field.appendChild(make('span', 'chip-field-label', label)); field.appendChild(value);
      fields.appendChild(field); outputs.set(name, value);
    }
    output('Playback', 'state');
    if (kind === 'msm5205') {
      output('Sample RAM', 'memory'); output('ADPCM rate', 'rate'); output('Clock', 'clock');
      output('Cursor', 'position'); output('Playback range', 'range'); output('Decoder mode', 'mode');
    } else {
      output('Track', 'track'); output('Track list', 'tracks'); output('Position / duration', 'position');
      output('Prepared PCM', 'memory'); output('Source frames', 'frames'); output('Output rate', 'rate');
    }
    output('Mixer volume', 'volume'); output('Mixer mute', 'mute');
    section.appendChild(fields); body.appendChild(section); container.appendChild(body);
    const status = make('p', 'chip-editor-status', 'Open this tab or press Refresh to read playback state.');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); container.appendChild(status);
    root.appendChild(container);
    const panel = {kind, doc, container, refreshButton, status, outputs}; panels.set(kind, panel);
    listen(refreshButton, 'click', () => { if (active === kind) void refresh(); });
    render(panel, null);
  }
  const documents = new Set([...panels.values()].map(panel => panel.doc));
  for (const doc of documents) listen(doc, 'visibilitychange', () => {
    if (disposed) return;
    if (doc.hidden) invalidate();
    else if (active && panels.get(active)?.doc === doc) void refresh();
  });

  function render(panel, state) {
    const set = (name, value) => { panel.outputs.get(name).textContent = value; };
    set('state', state ? states[state.state] ?? String(state.state ?? 'Ready') : 'Not initialized');
    set('volume', state && Number.isFinite(state.volume) ? state.volume.toFixed(3) : '—');
    set('mute', typeof state?.mute === 'boolean' ? state.mute ? 'On' : 'Off' : '—');
    if (panel.kind === 'msm5205') {
      const bytes = state?.sourceBytes ?? state?.sample?.bytes ?? 0, clock = state?.clock ?? 1536000;
      const code = state?.rate ?? state?.sample?.rate;
      const rate = state?.effectiveSampleRate ?? (Number.isInteger(code) && code >= 0 && code <= 15 ? clock / (48 * (16 - code)) : undefined);
      set('memory', `${integer(bytes)} / 65,536 bytes`);
      set('clock', `${number(clock)} Hz`);
      set('rate', rate === undefined ? '—' : `${number(rate)} Hz · code ${integer(code)}`);
      set('position', state ? `${integer(state.positionNibbles ?? state.cursor)} nibbles` : '—');
      set('range', state?.length ? `${integer(state.offset ?? 0)}–${integer((state.offset ?? 0) + state.length)} (${integer(state.length)} nibbles)` : 'No active sample');
      set('mode', state?.mode === 'raw' ? 'Raw register stream' : state?.mode ? 'Sample RAM' : '—');
    } else {
      const frames = state?.durationFrames;
      const duration = state?.durationSeconds ?? (Number.isFinite(frames) ? frames / 44100 : undefined);
      const position = state?.positionSeconds ?? (Number.isFinite(state?.positionFrames) ? state.positionFrames / 44100 : undefined);
      set('track', state?.track == null ? 'Not selected' : `${integer(state.track)}${state.title ? ` · ${state.title}` : ''}`);
      set('tracks', `${integer(state?.tracks?.length ?? 0)} tracks`);
      set('position', `${seconds(position)} / ${seconds(duration)}`);
      set('memory', `${integer(Number.isSafeInteger(frames) ? frames * 4 : 0)} bytes`);
      set('frames', state ? `${integer(state.positionFrames)} / ${integer(frames)}` : '—');
      set('rate', Number.isFinite(state?.sampleRate) ? `${number(state.sampleRate)} Hz` : '—');
    }
  }
  function invalidate() {
    generation++; pending = null;
    for (const panel of panels.values()) {
      panel.refreshButton.disabled = false; panel.container.setAttribute('aria-busy', 'false');
    }
  }
  function current(panel, token) {
    return !disposed && active === panel.kind && token === generation && !panel.doc.hidden;
  }
  function refresh() {
    const panel = panels.get(active);
    if (disposed || !panel || panel.doc.hidden) return Promise.resolve(null);
    if (pending?.kind === active && pending.generation === generation) return pending.promise;
    const token = ++generation;
    panel.refreshButton.disabled = true; panel.container.setAttribute('aria-busy', 'true');
    panel.status.textContent = 'Reading playback state…'; delete panel.status.dataset.error;
    const promise = Promise.resolve().then(() => current(panel, token) ? readState(panel.kind) : null)
      .then(state => {
        if (!current(panel, token)) return null;
        render(panel, state); panel.status.textContent = state
          ? 'Snapshot. Press Refresh to update.' : 'Not initialized. Run code to load this audio source.';
        return state;
      }).catch(error => {
        if (!current(panel, token)) return null;
        if (error?.name === 'AbortError') {panel.status.textContent = 'Audio source changed. Press Refresh to update.'; return null;}
        panel.status.textContent = error?.message ?? String(error); panel.status.dataset.error = 'true'; onError(error);
        return null;
      }).finally(() => {
        if (current(panel, token)) {panel.refreshButton.disabled = false;panel.container.setAttribute('aria-busy', 'false');}
        if (pending?.promise === promise) pending = null;
      });
    pending = {kind: active, generation: token, promise}; return promise;
  }
  return {
    setVisible(kind) {
      if (disposed) return Promise.resolve(null);
      const next = panels.has(kind) ? kind : null;
      if (active === next) return pending?.promise ?? Promise.resolve(null);
      invalidate(); active = next; return refresh();
    },
    refresh,
    dispose() {
      if (disposed) return; disposed = true; active = null; invalidate();
      for (const remove of listeners) remove();
      for (const panel of panels.values()) panel.container.remove();
    },
  };
}
