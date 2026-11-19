/** FM2612's expanded workspace uses the existing tabs and performance controls. */
export function setupSynthExpandedTabs({codeControls,selectChip}={}) {
  if(!codeControls||typeof selectChip!=='function')throw TypeError('Expanded tabs need Code and chip view controls.');
  const byId=id=>document.getElementById(id);
  const slot=byId('synthExpandedTabsSlot'),codeSlot=byId('synthExpandedCodeSlot');
  const volumeSlot=byId('synthExpandedVolumeSlot'),volume=byId('masterVolumeRange')?.closest('.volume-control');
  const codeLayoutButton=byId('synthWorkspaceCodeButton'),synthLayoutButton=byId('synthWorkspaceSynthButton');
  const editor=document.querySelector('#synthWorkspace .synth-editor');
  const codeTab=byId('synthInputCodeTab'),keyboardTab=byId('synthInputKeyboardTab');
  const chipTabs=['synthChipTabYm2612','synthChipTabPsg','synthChipTabPcm','synthChipTabPwm','synthSongMixButton'].map(byId);
  const tablist=chipTabs[0]?.parentNode,inputTablist=codeTab?.parentNode,inputHeading=inputTablist?.parentNode;
  const expand=byId('synthCodeExpandButton'),transport=byId('synthCodeRunButton')?.parentNode;
  if([slot,codeSlot,editor,codeTab,keyboardTab,tablist,inputTablist,inputHeading,expand,transport,...chipTabs].some(node=>!node))throw TypeError('Expanded tabs need the FM2612 workspace.');
  const tabs=[codeTab,...chipTabs,keyboardTab],heading=document.createElement('div');
  heading.className='synth-expanded-heading';
  const oldLabel=tablist.getAttribute('aria-label'),oldHeadingHidden=inputHeading.hidden;
  const anchors=new Map();
  const movable=[tablist,codeTab,keyboardTab,expand,transport,...(volumeSlot&&volume?[volume]:[])];
  for(const node of movable) {
    const anchor=document.createComment('Expanded workspace control');
    node.parentNode.insertBefore(anchor,node);anchors.set(node,anchor);
  }
  let expanded=false,disposed=false,layoutOperation=0,currentView=codeControls.isCodeMode()?'code':'keyboard';
  let currentChip=chipTabs.find(tab=>tab.getAttribute('aria-selected')==='true')??chipTabs[0];
  const select=(tab,selected)=>{
    tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;tab.classList.toggle('is-selected',selected);
  };
  function updateLayoutButtons() {
    for(const [button,selected]of [[codeLayoutButton,expanded],[synthLayoutButton,!expanded]]) {
      button?.setAttribute('aria-pressed',String(selected));button?.classList.toggle('is-selected',selected);
    }
  }
  function update() {
    if(!expanded)return;
    const input=currentView==='code'||currentView==='keyboard';
    editor.hidden=input;codeSlot.hidden=!input;
    slot.dataset.view=currentView;
    const selected=currentView==='code'?codeTab:currentView==='keyboard'?keyboardTab:currentChip;
    for(const tab of tabs)select(tab,tab===selected);
    codeControls.layoutEditor?.();
  }
  function restore(node) {
    const anchor=anchors.get(node);
    anchor.parentNode.insertBefore(node,anchor.nextSibling);
  }
  function setExpanded(value) {
    if(disposed)return;
    value=Boolean(value);
    if(expanded===value){if(expanded)update();return;}
    expanded=value;
    updateLayoutButtons();
    if(expanded) {
      currentView=codeControls.isCodeMode()?'code':'keyboard';
      tablist.insertBefore(codeTab,tablist.firstChild);tablist.append(keyboardTab);
      tablist.setAttribute('aria-label','Synth workspace');
      heading.append(tablist,expand);slot.append(heading,transport);
      if(volumeSlot&&volume){volumeSlot.append(volume);volumeSlot.hidden=false;}
      inputHeading.hidden=true;slot.hidden=false;
      update();
    }else {
      for(const node of movable)restore(node);
      if(volumeSlot)volumeSlot.hidden=true;
      heading.remove();slot.hidden=true;codeSlot.hidden=true;editor.hidden=false;
      inputHeading.hidden=oldHeadingHidden;
      if(oldLabel===null)tablist.removeAttribute('aria-label');else tablist.setAttribute('aria-label',oldLabel);
      for(const tab of chipTabs)select(tab,tab===currentChip);
      select(codeTab,codeControls.isCodeMode());select(keyboardTab,!codeControls.isCodeMode());
      codeControls.layoutEditor?.();
    }
  }
  function showInput(mode) {
    if(disposed||!['code','keyboard'].includes(mode))return;
    currentView=mode;update();
  }
  function showChip(button) {
    if(disposed||!chipTabs.includes(button))return;
    currentChip=button;
    if(expanded){currentView=button.dataset.synthChip;update();}
  }
  function keydown(event) {
    if(!expanded||event.metaKey||event.ctrlKey||event.altKey)return;
    const tab=event.target.closest?.('[role="tab"]');
    if(!tabs.includes(tab))return;
    const offsets={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1};
    if(!Object.hasOwn(offsets,event.key)&&event.key!=='Home'&&event.key!=='End')return;
    event.preventDefault();event.stopImmediatePropagation();
    const available=tabs.filter(button=>!button.disabled),index=available.indexOf(tab);
    const next=event.key==='Home'?available[0]:event.key==='End'?available.at(-1):available[(index+offsets[event.key]+available.length)%available.length];
    if(!next)return;
    const request=next===codeTab?codeControls.setMode('code',{focusEditor:false})
      :next===keyboardTab?codeControls.setMode('keyboard',{focusEditor:false}):selectChip(next);
    Promise.resolve(request).then(changed=>{if(changed!==false&&!disposed&&expanded)next.focus();}).catch(error=>codeControls.appendLog?.(error.message??String(error),'error'));
  }
  function click(event) {
    if(!expanded)return;
    const tab=event.target.closest?.('[role="tab"]');
    // The original chip handler still performs the selection exactly once.
    // Explicit focus also covers Safari's pointerdown suppression.
    if(chipTabs.includes(tab)&&!tab.disabled)tab.focus();
  }
  const report=error=>codeControls.appendLog?.(error.message??String(error),'error');
  const chooseCode=()=>{
    const request=++layoutOperation;
    void Promise.resolve(codeControls.setMode('code',{focusEditor:false})).then(changed=>{
      if(changed!==false&&!disposed&&request===layoutOperation)return codeControls.setExpanded(true);
    }).catch(report);
  };
  const chooseSynth=()=>{
    const request=++layoutOperation;
    void Promise.resolve(codeControls.setExpanded(false)).then(()=>{
      if(!disposed&&request===layoutOperation)synthLayoutButton?.focus();
    }).catch(report);
  };
  const buttonKeydown=event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();};
  tablist.addEventListener('keydown',keydown,true);
  tablist.addEventListener('click',click,true);
  codeLayoutButton?.addEventListener('click',chooseCode);
  synthLayoutButton?.addEventListener('click',chooseSynth);
  for(const button of [codeLayoutButton,synthLayoutButton])button?.addEventListener('keydown',buttonKeydown);
  updateLayoutButtons();
  if(codeControls.isExpanded())setExpanded(true);
  return {setExpanded,showInput,showChip,
    dispose(){if(disposed)return;setExpanded(false);disposed=true;layoutOperation++;tablist.removeEventListener('keydown',keydown,true);tablist.removeEventListener('click',click,true);codeLayoutButton?.removeEventListener('click',chooseCode);synthLayoutButton?.removeEventListener('click',chooseSynth);for(const button of [codeLayoutButton,synthLayoutButton])button?.removeEventListener('keydown',buttonKeydown);for(const anchor of anchors.values())anchor.remove();},
  };
}
