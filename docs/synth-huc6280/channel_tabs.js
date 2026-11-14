// SPDX-License-Identifier: BSD-3-Clause
/** The tabs select an existing channel target; they never copy sound settings. */
export function setupHuc6280ChannelTabs({root,panel,onSelect,onError=()=>{}}) {
  const tabs=[...root.querySelectorAll('[data-huc-channel]')],listeners=[];
  const listen=(tab,type,listener)=>{tab.addEventListener(type,listener);listeners.push(()=>tab.removeEventListener(type,listener));};
  let disposed=false;
  function sync(value) {
    if(disposed)return;
    const selected=tabs.find(tab=>tab.dataset.hucChannel===String(value));
    if(!selected)throw Error('Choose Auto or CH1–CH6.');
    for(const tab of tabs){const active=tab===selected;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;}
    panel?.setAttribute('aria-labelledby',selected.id);
  }
  function choose(tab) {
    if(disposed||tab.getAttribute('aria-selected')==='true')return;
    try{Promise.resolve(onSelect(tab.dataset.hucChannel)).catch(error=>{if(!disposed)onError(error);});}catch(error){onError(error);}
  }
  for(const tab of tabs) {
    listen(tab,'pointerdown',event=>{if(event.button===0)event.preventDefault();});
    listen(tab,'click',()=>{tab.blur();choose(tab);});
    listen(tab,'keydown',event=>{
      const index=tabs.indexOf(tab),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:null;
      if(next===null)return;
      event.preventDefault();choose(tabs[next]);tabs[next].focus();
    });
  }
  return {sync,dispose(){if(disposed)return;disposed=true;for(const remove of listeners)remove();}};
}
