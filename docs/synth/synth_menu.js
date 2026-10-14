export function setupSynthMenu({document, window}) {
  const menu = document.getElementById('synthMenu');
  const button = document.getElementById('synthMenuButton');
  if (!menu || !button) return;
  const panel = menu.querySelector('.synth-menu-panel');
  const close = () => {
    menu.open = false;
    button.setAttribute('aria-expanded', 'false');
  };
  menu.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(menu.open)));
  // Pointer actions keep the performance keyboard's current focus. Tab/Enter
  // still work for people navigating the menu with the keyboard.
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('keydown', event => {
    if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
  });
  panel.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) event.preventDefault();
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('[data-close-synth-menu]')) close();
  }, {capture:true});
  panel.addEventListener('keydown', event => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End',' ','Enter'].includes(event.key)) event.stopPropagation();
  });
  document.addEventListener('pointerdown', event => {
    if (menu.open && !menu.contains(event.target)) close();
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !menu.open) return;
    event.preventDefault(); event.stopPropagation(); close(); button.focus();
  }, {capture:true});
  for (const [action, input] of [['importPresetButton','tfiFile'], ['importEventRecordingButton','eventRecordImportInput']]) {
    document.getElementById(action)?.addEventListener('click', () => document.getElementById(input)?.click());
  }
}
