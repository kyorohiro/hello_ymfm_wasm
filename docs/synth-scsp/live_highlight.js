// SPDX-License-Identifier: BSD-3-Clause
import { createSynthLiveHighlighter } from '../synth/synth_live_highlight.js';

const envelope = ['attackRate', 'decay1Rate', 'decay2Rate', 'decayLevel', 'releaseRate', 'keyRateScaling', 'loopLink'];
const lfo = ['frequencyCode', 'pitchWave', 'pitchDepth', 'amplitudeWave', 'amplitudeDepth', 'reset'];
const mix = ['totalLevel', 'directLevel', 'pan'];
const modulation = ['depth', 'xOffset', 'yOffset', 'writeInhibit'];
const auto = ['voiceMode', 'algorithm', 'fmDepth', 'fmRatio', 'pitch', 'operatorRatio', 'operatorDepth'];

/** Cache after the voice panel, number steppers, loop-link and SSF view exist.
 * update() belongs at the end of the existing render, including its SSF branch.
 * There are no engine reads, selectors, timers or layout reads during updates.
 */
export function setupScspLiveHighlighter({ document: doc = globalThis.document, enabled = true } = {}) {
  const bindings = [];
  function bind(node, group, output = false) {
    if (!node) return;
    const checkbox = node.type === 'checkbox';
    const element = output || checkbox ? node.closest('label') ?? node
      : node.tagName === 'SELECT' ? node : node.closest('.scsp-stepper') ?? node;
    // Cache the complete ancestry once so later hidden-panel checks are bounded
    // property reads and do not rediscover the control tree on each render.
    const ancestors = [];
    for (let parent = node; parent; parent = parent.parentElement) ancestors.push(parent);
    const binding = { node, element, group, ancestors, visible: false };
    binding.read = () => !binding.visible ? undefined
      : output ? node.textContent : checkbox ? node.checked : node.value;
    bindings.push(binding);
  }
  const input = name => doc?.querySelector(`[data-chip-control="scsp-${name}"]`);
  bind(doc?.getElementById('scspPhysicalFrequency'), 'physical');
  bind(input('root'), 'ssf'); // Only the SSF playback rate, never PCM draft tuning.
  for (const name of [...envelope, ...lfo.map(key => `lfo-${key}`), ...mix]) bind(input(name), 'voice');
  for (const name of modulation) bind(input(`modulation-${name}`), 'physical');
  for (const id of auto) bind(doc?.getElementById(id), 'auto');
  const ssfModulation = doc?.querySelector('.scsp-ssf-modulation');
  for (const output of ssfModulation?.querySelectorAll('output') ?? []) bind(output, 'ssf', true);

  const highlighter = createSynthLiveHighlighter({ enabled, controls: bindings });
  let previousContext = null, previousVisibility = null, disposed = false;
  function clear() {
    highlighter.clear();
    previousContext = previousVisibility = null;
  }
  return {
    update(context) {
      // Off must precede even inspecting the context or any cached DOM property.
      if (!enabled || disposed) return;
      if (!context || (context.view !== undefined && context.view !== 'scsp')) { clear(); return; }
      const source = context.ssfVoice != null ? 'ssf' : 'code';
      const slot = source === 'ssf' ? context.ssfSlot : context.selected ?? context.operator ?? 0;
      const physical = source === 'code' && context.selected != null;
      const snapshot = context.ssfSnapshot;
      const voice = source === 'ssf' ? context.ssfVoice : context.state?.slots?.[slot];
      if (!voice || (source === 'ssf'
        ? context.following === false || context.playback !== 'playing' || !(snapshot?.frame > 0) || !snapshot.slots?.[slot]
        : !context.codeRunning)) { clear(); return; }
      const sample = source === 'ssf' ? snapshot.slots[slot].sample : voice.sample;
      const nextContext = [source, slot, context.operator, context.engine,
        source === 'ssf' ? context.ssfSession : context.codeSession ?? context.state?.codeSession,
        context.view ?? 'scsp', sample?.bankId, sample?.id,
        // SSF RAM is copied for each observation: its object identity is not a
        // sample-bank identity. The programmed source/start identifies that PCM.
        ...(source === 'ssf' ? [sample?.sourceMode, sample?.bits, sample?.startAddress] : [])];
      const visibility = bindings.map(binding => {
        const eligible = binding.group === 'voice' || binding.group === source ||
          binding.group === 'physical' && physical || binding.group === 'auto' && source === 'code' && !physical;
        binding.visible = eligible && !binding.ancestors.some(node => node.hidden);
        return binding.visible;
      });
      if (!previousContext || nextContext.some((value, index) => !Object.is(value, previousContext[index])) ||
        !previousVisibility || visibility.some((value, index) => value !== previousVisibility[index])) highlighter.clear();
      previousContext = nextContext;
      previousVisibility = visibility;
      // Compare what the render actually displayed. In particular, panel.update
      // is deferred for the entire panel while dragging; model readers would
      // otherwise pulse parameters whose displayed values have not changed.
      highlighter.update({ snapshot: { frame: source === 'ssf' ? snapshot.frame : 1 }, channel: slot });
    },
    clear,
    setEnabled(value) {
      if (typeof value !== 'boolean') throw new TypeError('Highlight enabled must be a boolean');
      if (disposed || value === enabled) return;
      enabled = value;
      clear();
      highlighter.setEnabled(value);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
      highlighter.dispose();
    },
  };
}
