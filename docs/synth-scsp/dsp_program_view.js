// SPDX-License-Identifier: BSD-3-Clause
// DSP draft authoring stays local; only explicit Apply uses the audio owner.
import {delayProgram} from './dsp.js?v=scsp-dsp-coef-1';
import {disassembleScspDsp} from './dsp_assembler.js';
import {checkScspDspDelaySource, validateScspDspDelayProgram} from './dsp_program.js?v=scsp-dsp-edit-1';

export const SCSP_DSP_DRAFT_STORAGE_KEY = 'tetorica-scsp-dsp-draft-v1';

const descriptions = [
  ['Prepare accumulator', 'Use MEMS0 and COEF0 with a zero B input.'],
  ['Read delay ring', 'Request RAM at MADRS0 + DEC on an odd step.'],
  ['Latch read result', 'IWT latches the preceding read into MEMS0.'],
  ['Output + feedback', 'Emit the previous accumulator to EFREG0 while calculating feedback with COEF1.'],
  ['Add input', 'Add MIXS0 × COEF2 to the feedback accumulator.'],
  ['Write delay ring', 'Write the previous shifted accumulator at MADRS1 + DEC.'],
];

/** Describe the fixed Delay without reading or writing an audio core. */
export function createScspDspDelayListing() {
  const words = delayProgram();
  const lines = disassembleScspDsp(words).trimEnd().split('\n');
  if (lines.length !== descriptions.length) throw Error('The built-in Delay changed; update its step descriptions.');
  const rows = lines.map((line, index) => {
    const match = /^(\d+):\s*(.*)$/.exec(line);
    if (!match || Number(match[1]) !== index) throw Error('Unexpected built-in Delay step position.');
    return {step: index, instruction: match[2], title: descriptions[index][0], detail: descriptions[index][1]};
  });
  const header = [
    '; Tetorica SCSP DSP - built-in Synth Delay',
    '; Experimental field syntax. Each line describes one physical microstep.',
    '; Coefficients, ring RAM, routing and Start are configured separately.',
    '; Unlisted steps through 127 contain zero words.',
    '',
  ];
  const source = header.concat(rows.flatMap(row => [
    `; ${row.title}: ${row.detail}`,
    `${String(row.step).padStart(3, '0')}: ${row.instruction}`,
    '',
  ])).join('\n');
  return {source, rows, stepCount: rows.length, imageSteps: words.length / 4,
    filename: 'tetorica-scsp-delay.scspasm'};
}

function fallbackCopy(root, source) {
  const previous = root.activeElement;
  const input = root.createElement('textarea');
  input.value = source;
  input.readOnly = true;
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.style.position = 'fixed';
  input.style.left = '-10000px';
  root.body.append(input);
  try {
    input.focus({preventScroll: true});
    input.select();
    return root.execCommand?.('copy') === true;
  } catch {
    return false;
  } finally {
    input.remove();
    previous?.focus?.({preventScroll: true});
  }
}

/** Populate draft controls and the built-in reference. Cleanup retires handlers and pending URLs.
 * Older cached HTML without the view can still initialize the rest of Synth.
 */
export function setupScspDspProgramView({root = globalThis.document,
  clipboard = globalThis.navigator?.clipboard, applyProgram = null,
  getAppliedProgram = delayProgram, storage} = {}) {
  const body = root.getElementById('scspDspProgramRows');
  const copy = root.getElementById('scspDspProgramCopy');
  const save = root.getElementById('scspDspProgramSave');
  const feedback = root.getElementById('scspDspProgramStatus');
  if (!body || !copy || !save || !feedback) return () => {};
  const editor = root.getElementById('scspDspProgramEditor');
  const check = root.getElementById('scspDspProgramCheck');
  const apply = root.getElementById('scspDspProgramApply');
  const reset = root.getElementById('scspDspProgramReset');
  const appliedStatus = root.getElementById('scspDspProgramApplied');
  const draftStatus = root.getElementById('scspDspProgramDraftStatus');
  const errorDisplay = root.getElementById('scspDspProgramError');
  const preview = root.getElementById('scspDspProgramPreview');
  const previewPanel = root.getElementById('scspDspProgramPreviewPanel');
  const editable = Boolean(editor && check && apply && reset && appliedStatus && draftStatus && errorDisplay && preview);
  const scrollRegion = body.closest('[role="region"]');
  const listing = createScspDspDelayListing();
  const rows = listing.rows.map(row => {
    const tr = root.createElement('tr');
    const step = root.createElement('th');
    step.scope = 'row';
    step.textContent = String(row.step).padStart(3, '0');
    const instruction = root.createElement('td');
    const code = root.createElement('code');
    code.textContent = row.instruction;
    instruction.append(code);
    const role = root.createElement('td');
    const title = root.createElement('strong');
    const detail = root.createElement('p');
    title.textContent = row.title;
    detail.textContent = row.detail;
    role.append(title, detail);
    tr.append(step, instruction, role);
    return tr;
  });
  body.replaceChildren(...rows);
  let disposed = false, copying = false, applying = false, checked = null;
  let appliedWords = validateScspDspDelayProgram(getAppliedProgram());
  let appliedSource = listing.source;
  const downloads = new Map();
  function message(value, error = false) {
    if (disposed) return;
    feedback.textContent = value;
    feedback.dataset.error = String(error);
  }
  message('');
  if (storage === undefined) {
    try { storage = (root.defaultView ?? globalThis).localStorage; } catch { storage = null; }
  }
  const draftSource = () => editable ? editor.value : listing.source;
  const sameWords = (a, b) => a.length === b.length && a.every((word, index) => word === b[index]);
  function showApplied() {
    if (!appliedStatus) return;
    const builtIn = sameWords(appliedWords, delayProgram());
    appliedStatus.textContent = builtIn ? 'Applied: Built-in Delay' : 'Applied: Custom program';
    appliedStatus.dataset.custom = String(!builtIn);
  }
  function buttons() {
    if (!editable || disposed) return;
    apply.disabled = applying || typeof applyProgram !== 'function' || checked?.source !== editor.value;
    apply.textContent = applying ? 'Applying…' : 'Apply to Synth';
  }
  function saveDraft() {
    try { storage?.setItem(SCSP_DSP_DRAFT_STORAGE_KEY, draftSource()); }
    catch { message('Could not save the local draft. Use Save .scspasm to keep it.', true); }
  }
  function invalidate() {
    if (!editable) return;
    checked = null;
    errorDisplay.textContent = '';
    delete errorDisplay.dataset.line;
    preview.textContent = '';
    if (previewPanel) previewPanel.open = false;
    draftStatus.textContent = editor.value === appliedSource ? 'Check the draft before Apply.' : 'Unapplied draft · Check required.';
    buttons();
  }
  function onInput() { invalidate(); saveDraft(); }
  function onCheck() {
    if (disposed || !editable) return;
    const source = editor.value;
    try {
      const result = checkScspDspDelaySource(source);
      checked = {...result, source};
      errorDisplay.textContent = '';
      delete errorDisplay.dataset.line;
      preview.textContent = result.listing || '; All-zero program image\n';
      draftStatus.textContent = sameWords(result.words, appliedWords)
        ? 'Checked · matches the applied program.' : 'Checked · unapplied program.';
      message('Check passed. The current sound is unchanged.');
      if (previewPanel) previewPanel.open = true;
    } catch (error) {
      checked = null;
      errorDisplay.textContent = error.message;
      const line = error.line ?? Number(/Line\s+(\d+)/i.exec(error.message)?.[1]);
      if (Number.isInteger(line) && line > 0) errorDisplay.dataset.line = String(line);
      preview.textContent = '';
      draftStatus.textContent = 'Check failed · current program kept.';
      message('Fix the draft and Check again.', true);
    }
    buttons();
  }
  async function onApply() {
    if (disposed || applying || !editable || checked?.source !== editor.value || typeof applyProgram !== 'function') return;
    const candidate = checked;
    const changed = !sameWords(candidate.words, appliedWords);
    applying = true;
    buttons();
    message('Applying to Synth…');
    try {
      const result = await applyProgram(Array.from(candidate.words));
      if (disposed) return;
      const accepted = validateScspDspDelayProgram(result?.words ?? candidate.words);
      if (!sameWords(accepted, candidate.words)) throw Error('The applied program did not match the checked draft.');
      appliedWords = accepted;
      appliedSource = candidate.source;
      showApplied();
      draftStatus.textContent = checked?.source === editor.value
        ? sameWords(checked.words, appliedWords) ? 'Checked · applied program.' : 'Checked · unapplied program.'
        : editor.value === candidate.source ? 'Applied text · Check required before another Apply.'
        : 'Earlier draft applied · newer edits need Check.';
      const enabled = root.getElementById('effectEnabled')?.checked;
      message(!changed ? 'Program already applied. Sound kept.' : result?.active === false
        ? 'Program applied to Synth setup. Enable audio to hear it.' : !enabled
        ? 'Program applied. Enable Delay to hear the DSP return.' : 'Program applied. DSP tail cleared; voices kept.');
    } catch (error) {
      if (!disposed) message('Apply failed: ' + error.message, true);
    } finally {
      applying = false;
      buttons();
    }
  }
  function onReset() {
    if (disposed || !editable) return;
    editor.value = listing.source;
    invalidate();
    saveDraft();
    message('Built-in Delay loaded into the draft. Check and Apply to use it.');
  }
  function onEditorKey(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      onCheck();
    }
  }
  if (editable) {
    let restored = null;
    try { restored = storage?.getItem(SCSP_DSP_DRAFT_STORAGE_KEY); } catch { /* Keep the new draft without replacing unreadable storage. */ }
    editor.value = typeof restored === 'string' ? restored : listing.source;
    invalidate();
    showApplied();
    if (restored !== null && restored !== undefined) message('Draft restored. It has not been applied.');
    editor.addEventListener('input', onInput);
    editor.addEventListener('keydown', onEditorKey);
    check.addEventListener('click', onCheck);
    apply.addEventListener('click', onApply);
    reset.addEventListener('click', onReset);
  }
  async function onCopy(event) {
    if (disposed || copying) return;
    copying = true;
    copy.disabled = true;
    const source = draftSource();
    try {
      let copied = false;
      try {
        if (typeof clipboard?.writeText === 'function') {
          await clipboard.writeText(source);
          copied = true;
        }
      } catch { /* The local selection fallback also works in restricted frames. */ }
      if (disposed) return;
      if (!copied) copied = fallbackCopy(root, source);
      message(copied ? 'Copied DSP draft.' : 'Copy unavailable. Use Save .scspasm.', !copied);
    } finally {
      copying = false;
      if (!disposed) {
        copy.disabled = false;
        if (event.detail > 0) copy.blur();
      }
    }
  }
  function releaseDownload(url) {
    clearTimeout(downloads.get(url));
    downloads.delete(url);
    URL.revokeObjectURL(url);
  }
  function onSave(event) {
    if (disposed) return;
    let url;
    try {
      url = URL.createObjectURL(new Blob([draftSource()], {type: 'text/plain;charset=utf-8'}));
      const link = root.createElement('a');
      link.href = url;
      link.download = listing.filename;
      root.body.append(link);
      try { link.click(); } finally { link.remove(); }
      downloads.set(url, setTimeout(() => releaseDownload(url), 1000));
      message('Download started: ' + listing.filename + '.');
    } catch (error) {
      if (url) releaseDownload(url);
      message('Could not save the program: ' + error.message, true);
    }
    if (event.detail > 0) save.blur();
  }
  // WebKit does not scroll a focused overflow region with horizontal arrows.
  // Consume only those navigation keys; musical letter keys remain available.
  function onScrollKey(event) {
    if (event.target !== scrollRegion || event.ctrlKey || event.metaKey || event.altKey) return;
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const maximum = scrollRegion.scrollWidth - scrollRegion.clientWidth;
    if (!direction || maximum <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    scrollRegion.scrollLeft = Math.max(0, Math.min(maximum, scrollRegion.scrollLeft + direction * 80));
  }
  copy.addEventListener('click', onCopy);
  save.addEventListener('click', onSave);
  scrollRegion?.addEventListener('keydown', onScrollKey);
  return () => {
    disposed = true;
    copy.removeEventListener('click', onCopy);
    save.removeEventListener('click', onSave);
    scrollRegion?.removeEventListener('keydown', onScrollKey);
    if (editable) {
      editor.removeEventListener('input', onInput);
      editor.removeEventListener('keydown', onEditorKey);
      check.removeEventListener('click', onCheck);
      apply.removeEventListener('click', onApply);
      reset.removeEventListener('click', onReset);
    }
    copy.disabled = false;
    for (const url of [...downloads.keys()]) releaseDownload(url);
  };
}
