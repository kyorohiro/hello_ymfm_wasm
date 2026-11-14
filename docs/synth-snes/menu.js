// SPDX-License-Identifier: BSD-3-Clause
/** One Web menu; desktop adapters fill its Audio section and mount the Pin. */
export function setupSnesMenu({document:doc=globalThis.document,window:win=globalThis.window}={}){
  const menu=doc.getElementById('synthMenu'),button=doc.getElementById('synthMenuButton'),panel=doc.getElementById('synthMenuPanel'),listeners=[];
  const listen=(node,type,fn,options)=>{node.addEventListener(type,fn,options);listeners.push(()=>node.removeEventListener(type,fn,options));};
  const close=()=>{menu.open=false;button.setAttribute('aria-expanded','false');};
  listen(menu,'toggle',()=>button.setAttribute('aria-expanded',String(menu.open)));
  listen(button,'pointerdown',event=>event.preventDefault());
  listen(button,'keydown',event=>{if([' ','Enter'].includes(event.key))event.stopPropagation();});
  listen(panel,'pointerdown',event=>{if(event.target.closest('button'))event.preventDefault();});
  listen(panel,'click',event=>{if(event.target.closest('[data-close-synth-menu]'))close();},{capture:true});
  listen(panel,'keydown',event=>event.stopPropagation());
  listen(doc,'pointerdown',event=>{if(menu.open&&!menu.contains(event.target))close();});
  listen(win,'keydown',event=>{if(event.key==='Escape'&&menu.open){event.preventDefault();event.stopPropagation();close();button.focus();}},{capture:true});
  for(const[id,target,card]of [['synthMenuSpc','loadSpc','spcSection'],['synthMenuAudioImport','loadAudio','sampleSection'],['synthMenuBrrImport','loadBrr','sampleSection']]){
    listen(doc.getElementById(id),'click',()=>{doc.getElementById(card).open=true;doc.getElementById(target).click();});
  }
  const reload=doc.querySelector('[data-reset-offline-cache]');
  // Native reload/confirmation is bound by the desktop adapter, once.
  const native=win.top===win&&typeof win.__TAURI_INTERNALS__?.invoke==='function'&&((win.location.protocol==='tauri:'&&win.location.hostname==='localhost')||(['http:','https:'].includes(win.location.protocol)&&win.location.hostname==='tauri.localhost'));
  if(!native)listen(reload,'click',()=>win.location.reload());
  return{dispose(){for(const cleanup of listeners)cleanup();}};
}
