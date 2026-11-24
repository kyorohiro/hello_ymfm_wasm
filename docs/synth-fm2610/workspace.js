// SPDX-License-Identifier: BSD-3-Clause

/** Share the same editor, transport and tabs between the two layouts. */
export function setupFm2610Workspace({showFiles, onViewChange, focusCode}) {
  const byId = id => document.getElementById(id);
  const workspace = byId('workspace');
  const sourceBar = byId('sourceTabs');
  const inputBar = byId('performanceTabs');
  const expandedBar = byId('codeWorkspaceTabs');
  const performanceHeading = byId('performanceHeading');
  const expandButton = byId('codeExpand');
  const expandIcon = expandButton.querySelector('path');
  const synthEditor = byId('synthEditor');
  const performance = byId('performancePanel');
  const monitor = byId('outputPanel');
  const codeMode = byId('codeMode'), synthMode = byId('synthMode');
  const keyboardTab = byId('keyboardTab'), codeTab = byId('codeTab');
  const sourceTabs = [...sourceBar.querySelectorAll('[role="tab"]')];
  const inputTabs = [keyboardTab, codeTab];
  const panels = new Map([...sourceTabs, ...inputTabs].map(tab => [tab, byId(tab.getAttribute('aria-controls'))]));
  let sourceTab = sourceTabs.find(tab => tab.getAttribute('aria-selected') === 'true');
  let inputTab = inputTabs.find(tab => tab.getAttribute('aria-selected') === 'true');
  let expandedView = codeTab;
  let expanded = false;

  function render() {
    const showingInput = inputTabs.includes(expandedView);
    synthEditor.hidden = expanded && showingInput;
    monitor.hidden = synthEditor.hidden;
    performance.hidden = expanded && !showingInput;
    for (const [tab, panel] of panels) {
      const selected = expanded ? tab === expandedView : tab === sourceTab || tab === inputTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
    }
    const activeInput = expanded ? (showingInput ? expandedView : null) : inputTab;
    expandButton.hidden = !expanded && activeInput !== codeTab;
    onViewChange({sourceTab, expanded, inputTab: activeInput});
  }

  function select(tabId, {focus = false, reveal = true} = {}) {
    const tab = byId(tabId);
    if (sourceTabs.includes(tab)) sourceTab = tab;
    else if (inputTabs.includes(tab)) inputTab = tab;
    else return;
    if (expanded && reveal) expandedView = tab;
    render();
    if (focus) tab.focus({preventScroll: true});
  }

  function setExpanded(value, {keepCode = false} = {}) {
    const active = document.activeElement;
    if (expanded !== value) {
      expanded = value;
      workspace.dataset.mode = expanded ? 'code' : 'synth';
      codeMode.setAttribute('aria-pressed', String(expanded));
      synthMode.setAttribute('aria-pressed', String(!expanded));
      if (expanded) {
        sourceBar.prepend(codeTab);
        sourceBar.append(keyboardTab);
        sourceBar.setAttribute('aria-label', 'Code workspace');
        expandedBar.append(sourceBar, expandButton);
        showFiles();
      } else {
        inputBar.append(keyboardTab, codeTab);
        performanceHeading.append(expandButton);
        sourceBar.setAttribute('aria-label', 'Sound source');
        synthEditor.prepend(sourceBar);
        if (keepCode) inputTab = codeTab;
      }
      expandedBar.hidden = !expanded;
      inputBar.hidden = expanded;
      expandButton.setAttribute('aria-pressed', String(expanded));
      expandButton.setAttribute('aria-label', expanded ? 'Restore Code' : 'Maximize Code');
      expandButton.title = expanded ? 'Restore Code below the Synth' : 'Maximize Code beside Files';
      expandIcon.setAttribute('d', expanded ?
        'M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5');
    }
    if (expanded) expandedView = codeTab;
    render();
    if (expanded || keepCode) focusCode();
    else if (active?.closest('[hidden]')) synthMode.focus({preventScroll: true});
  }

  for (const tab of panels.keys()) {
    tab.addEventListener('click', () => select(tab.id, {focus: true}));
    tab.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const siblings = [...tab.parentElement.querySelectorAll('[role="tab"]')];
      const index = siblings.indexOf(tab), last = siblings.length - 1;
      const next = {ArrowLeft: (index + last) % siblings.length,
        ArrowRight: (index + 1) % siblings.length, Home: 0, End: last}[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(siblings[next].id, {focus: true});
    });
  }
  codeMode.addEventListener('click', () => setExpanded(true));
  synthMode.addEventListener('click', () => setExpanded(false));
  expandButton.addEventListener('pointerdown', event => event.preventDefault());
  expandButton.addEventListener('click', () => setExpanded(!expanded, {keepCode: true}));
  render();
  return {select};
}
