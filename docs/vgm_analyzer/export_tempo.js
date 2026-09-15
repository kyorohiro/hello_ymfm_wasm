// Share LilyPond's onset-based estimate across export dialogs, once per track.
export function createExportTempoSettings(analyze) {
  let source = null, analysis = null;
  const initialized = new WeakMap();
  function getAnalysis(buffer) {
    if (source !== buffer || !analysis) {
      const next = analyze(buffer);
      source = buffer; analysis = next;
    }
    return analysis;
  }
  function prepare(buffer, input, help, detail = '') {
    const {tempo} = getAnalysis(buffer);
    if (initialized.get(input) !== buffer) {
      input.value = tempo.bpm;
      initialized.set(input, buffer);
    }
    help.textContent = (tempo.estimated
      ? `Suggested: ${tempo.bpm} BPM. Candidates: ${tempo.candidates.join(', ')}. Estimated from key-on intervals; half/double tempo may also fit.`
      : 'No reliable tempo estimate. Default: 120 BPM.') + ` You can change this value. ${detail}`;
  }
  return {getAnalysis, prepare};
}
