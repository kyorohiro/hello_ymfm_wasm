// SPDX-License-Identifier: BSD-3-Clause
// UI selection shares the Synth's physical CH / Auto source target.
export function setupScspDspRoutingView({root = globalThis.document,
  onSend, onReturn, onSource, onError = () => {}}) {
  const $ = id => root.getElementById(id);
  const events = new AbortController();
  let target = {kind: 'source', index: 0}, readOnly = false, disposed = false;
  const sendInputs = [$('scspDspInput'), $('scspDspSend')];
  const returnInputs = [[$('effectReturn'), $('scspDspReturn0Pan')],
    [$('scspDspReturn1Level'), $('scspDspReturn1Pan')]];
  const commit = (action) => Promise.resolve().then(() => {
    if (!disposed && !readOnly) return action();
  }).catch(onError);
  const bind = (node, callback) => node.addEventListener('change', () => {
    node.blur();
    if (!disposed && !readOnly) callback();
  }, {signal: events.signal});
  for (const [index, field] of ['input', 'level'].entries()) bind(sendInputs[index], () => {
    const selected = {...target}, value = Number(sendInputs[index].value);
    void commit(() => onSend(selected, {[field]: value}));
  });
  for (let output = 0; output < 2; output++) {
    for (const [index, field] of ['level', 'pan'].entries()) bind(returnInputs[output][index], () => {
      const value = Number(returnInputs[output][index].value);
      void commit(() => onReturn(output, {[field]: value}));
    });
  }
  bind($('scspDspSource'), () => onSource(Number($('scspDspSource').value)));
  $('scspDspRouteDefault').addEventListener('click', () => {
    $('scspDspRouteDefault').blur();
    if (disposed || readOnly) return;
    const selected = {...target};
    void commit(() => onSend(selected, null));
  }, {signal: events.signal});
  function set(input, value) {
    if (root.activeElement !== input && !input.classList.contains('is-dragging')) input.value = String(value);
    input.disabled = readOnly;
  }
  const panText = pan => pan === 0 || pan === 16 ? 'Center'
    : pan === 15 ? 'Right only' : pan === 31 ? 'Left only'
      : `${pan < 16 ? 'Right' : 'Left'} · ${pan & 15}/15`;
  return {
    update(state, {selected = null, operator = 0, readOnly: locked = false} = {}) {
      if (disposed) return;
      readOnly = locked;
      target = {kind: selected === null ? 'source' : 'slot', index: selected ?? operator};
      const source = target.kind === 'source', key = source ? 'sources' : 'slots';
      const route = state.dspRouting?.[key]?.[target.index] ?? {input: 0, level: state.config.effect.send};
      const override = state.dspRoutingOverrides?.[key]?.[target.index];
      $('scspDspSourceLabel').hidden = !source;
      set($('scspDspSource'), operator);
      $('scspDspSendTarget').textContent = source ? `Auto · source ${'ABCDEF'[operator]}` : `CH${selected + 1} · Send`;
      set(sendInputs[0], route.input); set(sendInputs[1], route.level);
      $('scspDspRouteDefault').disabled = readOnly || override == null;
      $('scspDspRouteStatus').textContent = locked ? 'SSF has a separate DSP'
        : `${override == null ? 'Inherited' : 'Edited'} · MIXS${route.input} · ${state.config.effect.enabled ? 'returns enabled' : 'returns disabled'}`;
      const returns = state.dspReturns ?? [{level: state.config.effect.returnLevel, pan: 0}, {level: 0, pan: 0}];
      for (let output = 0; output < 2; output++) {
        const value = returns[output];
        set(returnInputs[output][0], value.level); set(returnInputs[output][1], value.pan);
        $(`scspDspReturn${output}Status`).textContent = !state.config.effect.enabled ? 'Returns disabled'
          : value.level === 0 ? 'Muted' : panText(value.pan);
      }
      $('effectEnabled').disabled = readOnly;
    },
    dispose() {disposed = true; events.abort();},
  };
}
