// SPDX-License-Identifier: BSD-3-Clause
import {buildKeyboard,createFretboardLayout,createFretboardState,findLayoutEntry,renderFretboardControls,
  setFretPosition,setInstrument,setStringWindowIndex,shiftStringWindowIndex} from '../synth/synth_keyboard.js';
import {createParamControl} from '../synth/synth_controls.js';

const padLetters=['a','s','d'];
export function padVoiceLabel(index){
  return 'Voice '+(index+1)+' ('+padLetters[index]+')';
}

export function setupKeyboard({press,release,triggerPad}){
  const el=id=>document.getElementById(id);
  const state=createFretboardState(),held=new Map(),root=el('keys');
  let octave=0,layout,padMode=false;
  function down(id,entry){
    if(held.has(id))return;
    const button=root.querySelector('[data-key="'+entry.key+'"]');
    held.set(id,button);button.classList.add('playing');press(id,entry.midi);
  }
  function up(id){
    const button=held.get(id);
    if(!button)return;
    release(id);held.delete(id);
    if(![...held.values()].includes(button))button.classList.remove('playing');
  }
  function clear(){for(const id of held.keys())up(id);}
  function render(){
    clear();
    layout=createFretboardLayout({state,octave});
    renderFretboardControls({
      instrumentRoot:el('instruments'),positionRoot:el('positions'),stringWindowRoot:el('strings'),
      fretDisplayRoot:el('fret'),state,
      onInstrumentChange:value=>{setInstrument(state,value);render();},
      onPositionPresetSelect:value=>{setFretPosition(state,value);render();},
      onStringWindowChange:value=>{setStringWindowIndex(state,value);render();},
    });
    for(const button of el('board-controls').querySelectorAll('.toolbar-button'))
      button.setAttribute('aria-pressed',String(button.classList.contains('is-selected')));
    buildKeyboard({root,rowDefs:layout.rowDefs,layoutEntries:layout.entries,showPitch:false,
      onPointerDown:(e,entry)=>down('pointer'+e.pointerId,entry),
      onPointerUp:e=>up('pointer'+e.pointerId),onPointerCancel:e=>up('pointer'+e.pointerId)});
    for(const button of root.querySelectorAll('button')){
      const entry=findLayoutEntry(layout.entries,button.dataset.key);
      const pointerOnly=el('use-adpcm').checked && /^[123]$/.test(entry.key);
      if(pointerOnly)button.querySelector('strong').textContent='F'+entry.fret;
      button.setAttribute('aria-label','String '+entry.stringNumber+', fret '+entry.fret+', '+entry.noteName);
      if(!pointerOnly)button.setAttribute('aria-keyshortcuts',entry.label);
    }
  }
  el('octave').append(createParamControl({label:'Octave',min:-2,max:2,step:1,value:0,
    onChange:value=>{octave=value;render();}}).element);
  for(let i=1;i<=3;i++){
    const b=document.createElement('button');b.textContent='ADPCM '+i;
    b.onclick=()=>triggerPad(i);el('pad-keys').append(b);
  }
  window.addEventListener('keydown',e=>{
    if(e.defaultPrevented || e.isComposing || e.ctrlKey || e.altKey || e.metaKey ||
      e.target.isContentEditable || e.target.closest?.('input:not([type=range]):not([type=checkbox]),select:not([data-performance-picker]),textarea,.monaco-editor,[role=textbox]'))return;
    const key=e.key.toLowerCase();
    // Preserve native picker navigation while letting mapped note keys play.
    if(e.target.matches?.('select[data-performance-picker]') && key.length!==1)return;
    if((padMode || el('use-adpcm').checked) && /^[123]$/.test(key)){
      e.preventDefault();if(!e.repeat)triggerPad(Number(key));return;
    }
    if(padMode){
      const i=padLetters.indexOf(key);
      if(i>=0){e.preventDefault();if(!e.repeat)triggerPad(i+1);}
      return;
    }
    if(key.startsWith('arrow')){
      if(e.target.closest?.('input,[role=slider],[role=tablist],.param-control'))return;
      e.preventDefault();
      if(key==='arrowup'||key==='arrowdown')shiftStringWindowIndex(state,key==='arrowup'?1:-1);
      else setFretPosition(state,Math.min(24,state.horizontalFretPosition+(key==='arrowright'?1:-1)));
      render();return;
    }
    const focused=e.target.closest?.('#keys button');
    const entry=findLayoutEntry(layout.entries,focused && (key===' '||key==='enter')?focused.dataset.key:key);
    if(entry){e.preventDefault();if(!e.repeat)down(e.code,entry);}
  });
  window.addEventListener('keyup',e=>up(e.code));
  window.addEventListener('blur',clear);
  let useAdpcm;
  function setPadMode(enabled){
    const checked=el('use-adpcm').checked;
    if(padMode===enabled && useAdpcm===checked)return;
    padMode=enabled;useAdpcm=checked;
    render();
    root.hidden=el('board-controls').hidden=el('octave').hidden=enabled;
    el('keyboard').classList.toggle('pad-mode',enabled);
    [...el('pad-keys').children].forEach((button,i)=>{
      const key=padLetters[i].toUpperCase();
      button.textContent=enabled?padVoiceLabel(i):'ADPCM '+(i+1);
      if(enabled || checked)button.setAttribute('aria-keyshortcuts',enabled?key+' '+(i+1):String(i+1));
      else button.removeAttribute('aria-keyshortcuts');
    });
  }
  setPadMode(false);
  return setPadMode;
}
