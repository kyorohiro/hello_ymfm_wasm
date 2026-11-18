// SPDX-License-Identifier: BSD-3-Clause
// A passive description of configured routes, never an audio/activity meter.
const families = new Set(['routing', 'delay', 'fir2', 'iir1']);
const programNames = {routing: 'Gain / IIR', delay: 'Delay', fir2: 'FIR', iir1: 'IIR'};
const panDescription = pan => pan === 0 || pan === 16 ? 'Center'
  : pan === 15 ? 'Right only' : pan === 31 ? 'Left only'
    : `${pan < 16 ? 'Right' : 'Left'} · code ${pan}`;
function outputSides(level, pan, enabled = true) {
  const state = !enabled ? 'disabled' : level === 0 ? 'muted' : 'enabled';
  return {
    left: state !== 'enabled' ? state : pan === 15 ? 'muted' : 'enabled',
    right: state !== 'enabled' ? state : pan === 31 ? 'muted' : 'enabled',
  };
}

/** Derive only routing facts that are known from the selected Synth settings.
 * A shared Return may contain other voices or DSP history. A custom program's
 * MIXS-to-EFREG connectivity is intentionally not inferred from its slot/bus.
 */
export function describeScspDspSignalFlow(state, {
  selected = null, operator = 0, program = null, readOnly = false,
} = {}) {
  const physical = selected !== null, index = selected ?? operator;
  const key = physical ? 'slots' : 'sources';
  const source = physical ? `CH${selected + 1}` : `Auto · source ${'ABCDEF'[operator]}`;
  const summarySource = physical ? source : `Auto ${'ABCDEF'[operator]}`;
  const route = state.dspRouting?.[key]?.[index] ?? {input: 0, level: state.config.effect.send};
  const family = families.has(program) ? program : 'custom';
  const returns = state.dspReturns ?? [{level: state.config.effect.returnLevel, pan: 0}, {level: 0, pan: 0}];
  const enabled = state.config.effect.enabled;
  const voice = state.slots?.[index] ?? {directLevel: 0, pan: 0};
  const suppressed = !physical && Array.isArray(state.routing?.outputs) && !state.routing.outputs.includes(operator);
  const directLevel = suppressed ? 0 : voice.directLevel;
  const mapping = output => family === 'custom' ? 'program-defined'
    : family === 'routing' ? route.input === output ? 'selected' : 'other-input'
      : output === 1 ? 'unused' : route.input === 0 ? 'selected' : 'other-input';
  const selectedPath = family === 'custom' ? 'program-defined'
    : family === 'routing' || route.input === 0 ? 'selected' : 'unused';
  return {
    source, summary: `Signal flow · ${summarySource} → MIXS${route.input}`,
    readOnly,
    send: {input: route.input, level: route.level, state: route.level === 0 ? 'muted' : 'enabled'},
    program: {family, name: programNames[family] ?? 'Custom program', route: selectedPath,
      detail: family === 'custom' ? 'Input / output paths are program-defined'
        : family === 'routing' ? 'MIXS0 → Gain → Return 0 · MIXS1 → IIR → Return 1'
          : route.input === 0 ? 'MIXS0 → Return 0' : `MIXS${route.input} unused · MIXS0 → Return 0`},
    returns: returns.map((value, output) => ({
      output, level: value.level, pan: value.pan, panLabel: panDescription(value.pan),
      state: !enabled ? 'disabled' : value.level === 0 ? 'muted' : 'enabled',
      route: mapping(output),
      detail: family === 'custom' ? 'Program-defined input'
        : family === 'routing' ? `${output === 0 ? 'Gain' : 'IIR'} · MIXS${output}`
          : output === 0 ? 'MIXS0' : 'Not written by this program',
      sides: outputSides(value.level, value.pan, enabled),
    })),
    direct: {level: directLevel, pan: voice.pan, panLabel: panDescription(voice.pan),
      state: suppressed ? 'modulator' : directLevel === 0 ? 'muted' : 'enabled',
      detail: suppressed ? 'Auto modulator · direct output suppressed' : `Direct ${directLevel} · ${panDescription(voice.pan)}`,
      sides: outputSides(directLevel, voice.pan)},
    notice: readOnly
      ? 'Synth settings only · SSF has a separate DSP.'
      : 'Configured paths, not a level meter. Shared Returns can include other CHs and DSP history.',
  };
}

/** The details element owns disclosure / focus behavior. This view only writes
 * text and attributes, and defers its diagram work until the details is open.
 */
export function setupScspDspSignalFlow({root = globalThis.document} = {}) {
  const details = root.getElementById('scspDspSignalFlow');
  const body = root.getElementById('scspDspSignalFlowBody');
  const summary = root.getElementById('scspDspSignalFlowSummary');
  if (!details || !body || !summary) return {update() {}, dispose() {}};
  let disposed = false, model = null, rendered = null, nodes = null;
  const doc = body.ownerDocument ?? root;
  const node = (tag, className, text) => {
    const value = doc.createElement(tag);
    if (className) value.className = className;
    if (text !== undefined) value.textContent = text;
    return value;
  };
  const text = (value, next) => {if (value.textContent !== next) value.textContent = next;};
  const data = (value, name, next) => {if (value.dataset[name] !== String(next)) value.dataset[name] = String(next);};
  const attribute = (value, name, next) => {if (value.getAttribute(name) !== next) value.setAttribute(name, next);};
  function createNodes() {
    const source = node('div', 'scsp-dsp-flow-source'); source.dataset.flow = 'source';
    const sourceName = node('h4'), sourceInfo = node('p', 'scsp-dsp-flow-detail', 'Selected voice');
    source.append(sourceName, sourceInfo);
    const send = node('div', 'scsp-dsp-flow-send'); send.dataset.flow = 'send';
    const sendName = node('h4'), sendInfo = node('p', 'scsp-dsp-flow-detail'); send.append(sendName, sendInfo);
    const program = node('div', 'scsp-dsp-flow-program'); program.dataset.flow = 'program';
    const programName = node('h4'), programInfo = node('p', 'scsp-dsp-flow-detail'); program.append(programName, programInfo);
    const returns = node('div', 'scsp-dsp-flow-returns');
    function sides() {
      const group = node('span', 'scsp-dsp-flow-sides');
      const left = node('span', 'scsp-dsp-flow-side', 'L'), right = node('span', 'scsp-dsp-flow-side', 'R');
      left.dataset.side = 'left'; right.dataset.side = 'right'; group.append(left, right);
      return {group, left, right};
    }
    const outputs = [0, 1].map(output => {
      const card = node('div', 'scsp-dsp-flow-return'); card.dataset.flow = 'return'; card.dataset.output = String(output);
      const name = node('h4', '', `Return ${output} · EFREG${output}`), detail = node('p', 'scsp-dsp-flow-detail');
      const setting = node('p', 'scsp-dsp-flow-setting'), outputs = sides();
      card.append(name, detail, setting, outputs.group); returns.append(card);
      return {card, detail, setting, ...outputs};
    });
    const direct = node('div', 'scsp-dsp-flow-direct'); direct.dataset.flow = 'direct';
    const directName = node('h4', '', 'Direct output'), directInfo = node('p', 'scsp-dsp-flow-detail'), directSides = sides();
    direct.append(directName, directInfo, directSides.group);
    const note = node('p', 'scsp-dsp-flow-note'); note.dataset.flow = 'notice';
    body.replaceChildren(source, send, program, returns, direct, note);
    return {source, sourceName, sourceInfo, send, sendName, sendInfo,
      program, programName, programInfo, outputs, direct, directInfo, directSides, note};
  }
  function render() {
    if (disposed || !model || !details.open) return;
    const signature = JSON.stringify(model);
    if (signature === rendered) return;
    nodes ??= createNodes();
    data(body, 'readOnly', model.readOnly);
    text(nodes.sourceName, model.source);
    text(nodes.sourceInfo, model.readOnly ? 'Synth view · read-only' : 'Selected voice');
    text(nodes.sendName, `MIXS${model.send.input}`);
    text(nodes.sendInfo, `Send ${model.send.level}${model.send.level === 0 ? ' · disconnected' : ''}`);
    for (const [name, value] of Object.entries(model.send)) data(nodes.send, name, value);
    data(nodes.program, 'program', model.program.family); data(nodes.program, 'route', model.program.route);
    text(nodes.programName, `DSP · ${model.program.name}`); text(nodes.programInfo, model.program.detail);
    for (const value of model.returns) {
      const target = nodes.outputs[value.output];
      for (const key of ['state', 'route', 'level', 'pan']) data(target.card, key, value[key]);
      text(target.detail, value.detail);
      text(target.setting, `${value.state === 'disabled' ? 'Disabled' : `Level ${value.level}`} · Pan ${value.pan} · ${value.panLabel}`);
      for (const side of ['left', 'right']) {
        data(target[side], 'state', value.sides[side]);
        attribute(target[side], 'aria-label', `${side === 'left' ? 'Left' : 'Right'} ${value.sides[side]}`);
      }
    }
    for (const key of ['state', 'level', 'pan']) data(nodes.direct, key, model.direct[key]);
    text(nodes.directInfo, model.direct.detail);
    for (const side of ['left', 'right']) {
      data(nodes.directSides[side], 'state', model.direct.sides[side]);
      attribute(nodes.directSides[side], 'aria-label', `Direct ${side} ${model.direct.sides[side]}`);
    }
    text(nodes.note, model.notice);
    rendered = signature;
  }
  details.addEventListener('toggle', render);
  return {
    update(state, options) {
      if (disposed || !state) return;
      model = describeScspDspSignalFlow(state, options);
      text(summary, model.summary);
      render();
    },
    dispose() {disposed = true; details.removeEventListener('toggle', render);},
  };
}
