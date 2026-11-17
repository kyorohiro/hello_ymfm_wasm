// SPDX-License-Identifier: BSD-3-Clause
// Passive view of the built-in Synth Delay, independent of any audio instance.
import {delayProgram} from './dsp.js';
import {disassembleScspDsp} from './dsp_assembler.js';

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

/** Populate the read-only listing. Cleanup retires handlers and pending URLs.
 * Older cached HTML without the view can still initialize the rest of Synth.
 */
export function setupScspDspProgramView({root = globalThis.document,
  clipboard = globalThis.navigator?.clipboard} = {}) {
  const body = root.getElementById('scspDspProgramRows');
  const copy = root.getElementById('scspDspProgramCopy');
  const save = root.getElementById('scspDspProgramSave');
  const feedback = root.getElementById('scspDspProgramStatus');
  if (!body || !copy || !save || !feedback) return () => {};
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
  let disposed = false, copying = false;
  const downloads = new Map();
  function message(value, error = false) {
    if (disposed) return;
    feedback.textContent = value;
    feedback.dataset.error = String(error);
  }
  message('');
  async function onCopy(event) {
    if (disposed || copying) return;
    copying = true;
    copy.disabled = true;
    try {
      let copied = false;
      try {
        if (typeof clipboard?.writeText === 'function') {
          await clipboard.writeText(listing.source);
          copied = true;
        }
      } catch { /* The local selection fallback also works in restricted frames. */ }
      if (disposed) return;
      if (!copied) copied = fallbackCopy(root, listing.source);
      message(copied ? 'Copied Delay program.' : 'Copy unavailable. Use Save .scspasm.', !copied);
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
      url = URL.createObjectURL(new Blob([listing.source], {type: 'text/plain;charset=utf-8'}));
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
    copy.disabled = false;
    for (const url of [...downloads.keys()]) releaseDownload(url);
  };
}
