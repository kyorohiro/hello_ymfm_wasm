/** Desktop engine selection is explicit and local to this page URL.
 * A normal launch always uses the browser's Web Audio implementation. */
export function resolvePlaygroundAudioEngine({search = '', desktop = false, modeId} = {}) {
  const requested = new URLSearchParams(search).get('audioEngine') === 'native' ? 'native' : 'webaudio';
  const available = desktop && modeId === 'genesis';
  return {requested, engine: requested === 'native' && available ? 'native' : 'webaudio', available};
}

export function createPlaygroundAudioEngineUrl(currentUrl, engine) {
  if (!['webaudio', 'native'].includes(engine)) throw new Error(`Unknown audio engine: ${engine}`);
  const url = new URL(currentUrl);
  url.searchParams.delete('audioEngine');
  if (engine === 'native') url.searchParams.set('audioEngine', 'native');
  return url;
}

/** The host owns stopping, preserving the project and replacing its backend. */
export function installPlaygroundAudioEngineSettings({document, host, selection, onChange}) {
  const button = document.createElement('button');
  button.id = 'audioEngineButton'; button.type = 'button'; button.className = 'menu-setting-row';
  button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-controls', 'audioEngineDialog');
  const label = document.createElement('span'); label.textContent = 'Audio engine…';
  const value = document.createElement('small'); value.className = 'menu-value';
  value.textContent = selection.engine === 'native' ? 'Native · experimental' : 'Web Audio';
  button.append(label, value); host.append(button);

  const dialog = document.createElement('dialog'); dialog.id = 'audioEngineDialog';
  dialog.className = 'playground-settings-dialog'; dialog.setAttribute('aria-label', 'Audio engine');
  const heading = document.createElement('h2'); heading.textContent = 'Audio engine';
  const select = document.createElement('select'); select.id = 'audioEngineSelect';
  select.setAttribute('aria-label', 'Audio engine');
  for (const [text, engine] of [['Web Audio (default)', 'webaudio'], ['Native Genesis (experimental)', 'native']]) {
    const option = document.createElement('option'); option.value = engine; option.textContent = text;
    option.disabled = engine === 'native' && !selection.available;
    select.append(option);
  }
  select.value = selection.engine;
  const explanation = document.createElement('p');
  explanation.textContent = 'Web Audio uses the same audio engine as the browser version. Native is an experimental Genesis engine for FM and PSG. Changing engine stops playback and reloads the current project.';
  const limits = document.createElement('p');
  limits.textContent = 'Native supports Main and Worker, FM, PSG, DAC, samples, noise, built-in FX, Audio monitoring and output recording. Compressed samples use the browser decoder during loading. Use Web Audio for extra chips and JavaScript liveFx.';
  const keyboardHint = document.createElement('p');
  keyboardHint.textContent = 'Native Keyboard uses the selected physical channel. Choose a free channel during script playback; script writes can replace a manually held note.';
  const status = document.createElement('p'); status.id = 'audioEngineStatus'; status.setAttribute('role', 'status');
  status.textContent = !selection.available ? 'Native is available in Genesis mode only.'
    : selection.engine === 'native' ? 'Native selected. Press Run or audition a note to start audio.' : 'Web Audio is the default. Selecting Native does not start playback.';
  const apply = document.createElement('button'); apply.type = 'button'; apply.id = 'audioEngineApply'; apply.textContent = 'Apply engine';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
  const mainMenu = document.getElementById('mainMenu');
  let busy = false;
  button.addEventListener('click', () => {
    if (mainMenu) mainMenu.open = false;
    select.value = selection.engine;
    if (!dialog.open) dialog.showModal();
    select.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => mainMenu?.querySelector(':scope > summary')?.focus());
  dialog.addEventListener('cancel', event => {if (busy) event.preventDefault();});
  apply.addEventListener('click', async () => {
    if (busy || select.value === selection.engine) {if (!busy) dialog.close(); return;}
    if (select.value === 'native' && !selection.available) return;
    busy = true; apply.disabled = select.disabled = close.disabled = true;
    status.textContent = 'Saving the project and changing audio engine…';
    try {await onChange(select.value);}
    catch (error) {
      status.textContent = `Could not change audio engine: ${error.message ?? error}`;
      busy = false; apply.disabled = select.disabled = close.disabled = false;
    }
  });
  dialog.append(heading, select, explanation, limits, keyboardHint, status, apply, close); document.body.append(dialog);
  return {button, dialog};
}
