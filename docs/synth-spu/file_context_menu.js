// SPDX-License-Identifier: BSD-3-Clause
// File selection and actions belong to the host. Opening this menu never opens
// a document, applies an instrument or dispatches an audition command.
export function installSpuFileContextMenu({root,document:doc=root?.ownerDocument??globalThis.document,
  getActions,onAction,onTarget=()=>{},isBusy=()=>false,onError=()=>{}}={}) {
  if(!root||!doc?.body||[getActions,onAction,onTarget,isBusy,onError].some(value=>typeof value!=='function'))
    throw TypeError('SPU file context menu needs a root and host callbacks.');
  const win=doc.defaultView??globalThis,element=doc.createElement('div'),listeners=[];
  element.id='spuFileContextMenu';element.className='spu-file-context-menu';element.hidden=true;element.tabIndex=-1;
  element.setAttribute('role','menu');element.setAttribute('aria-label','File actions');element.style.position='fixed';
  doc.body.append(element);
  let disposed=false,path='/',items=[],active=-1;
  const listen=(target,type,callback,options)=>{target.addEventListener(type,callback,options);listeners.push(()=>target.removeEventListener(type,callback,options));};
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation();};
  const rowFor=target=>{
    const node=target?.closest?.('[data-file-path]')??target?.parentElement?.closest?.('[data-file-path]');
    return node&&root.contains(node)?node:null;
  };
  const pathFor=target=>rowFor(target)?.getAttribute('data-file-path')??'/';
  function focusRow() {
    const row=[...root.querySelectorAll('[data-file-path]')].find(node=>node.getAttribute('data-file-path')===path);
    const focusable=row?.matches('button,summary,[tabindex]')?row:row?.querySelector('button,summary,[tabindex]');
    focusable?.focus?.({preventScroll:true});
  }
  function close(restoreFocus=false) {
    const wasOpen=!element.hidden;element.hidden=true;active=-1;
    if(wasOpen&&restoreFocus)focusRow();return wasOpen;
  }
  function actionsFor(targetPath) {
    const actions=getActions(targetPath);
    if(!Array.isArray(actions)||actions.some(action=>!action||typeof action.id!=='string'||typeof action.label!=='string'))
      throw TypeError('File menu actions need string IDs and labels.');
    return actions;
  }
  function activate(index) {
    const item=items[index];if(!item||item.disabled)return;
    const selectedPath=path,id=item.dataset.fileAction;
    try {
      const allowed=!isBusy()&&actionsFor(selectedPath).some(action=>action.id===id&&!action.disabled);
      close();if(!allowed)return;
      Promise.resolve(onAction(id,selectedPath)).catch(onError);
    }catch(error){close();onError(error);}
  }
  function select(index,focus=true) {
    active=index;items.forEach((item,i)=>{item.tabIndex=i===index?0:-1;});
    if(focus)(items[index]??element).focus({preventScroll:true});
  }
  function open(targetPath,x,y,keyboard=false) {
    if(disposed||isBusy()){close();return;}
    try {
      close();path=targetPath;onTarget(path);
      if(disposed||isBusy())return;
      items=actionsFor(path).map(action=>{
        const button=doc.createElement('button');button.type='button';button.textContent=action.label;
        button.setAttribute('role','menuitem');button.dataset.fileAction=action.id;button.disabled=Boolean(action.disabled);
        button.setAttribute('aria-disabled',String(button.disabled));button.tabIndex=-1;return button;
      });
      element.replaceChildren(...items);element.hidden=false;
      const width=win.innerWidth??doc.documentElement.clientWidth,height=win.innerHeight??doc.documentElement.clientHeight;
      element.style.boxSizing='border-box';element.style.maxWidth=Math.max(0,width-8)+'px';element.style.maxHeight=Math.max(0,height-8)+'px';element.style.overflowY='auto';
      const rect=element.getBoundingClientRect();
      element.style.left=Math.max(4,Math.min(Number.isFinite(x)?x:4,width-rect.width-4))+'px';
      element.style.top=Math.max(4,Math.min(Number.isFinite(y)?y:4,height-rect.height-4))+'px';
      if(keyboard)select(items.findIndex(item=>!item.disabled));
    }catch(error){close();onError(error);}
  }
  listen(root,'pointerdown',event=>{if(event.button===2)event.preventDefault();});
  listen(root,'contextmenu',event=>{consume(event);open(pathFor(event.target),event.clientX,event.clientY);});
  listen(root,'keydown',event=>{
    if(event.key!=='ContextMenu'&&!(event.shiftKey&&event.key==='F10'))return;
    consume(event);const row=rowFor(event.target)??root,rect=row.getBoundingClientRect();open(pathFor(event.target),rect.left,rect.bottom,true);
  });
  listen(element,'pointerdown',event=>{event.preventDefault();event.stopPropagation();});
  listen(element,'click',event=>{
    const item=event.target?.closest?.('[data-file-action]');if(!item||!element.contains(item))return;
    consume(event);activate(items.indexOf(item));
  });
  // The Synth's document capture listener may have been installed first.
  // Intercept at window capture so menu keys cannot play notes or stop audio.
  listen(win,'keydown',event=>{
    if(element.hidden)return;
    if(event.key==='Tab'){event.stopImmediatePropagation();close();return;}
    consume(event);
    if(event.key==='Escape'){close(true);return;}
    const enabled=items.map((item,index)=>item.disabled?-1:index).filter(index=>index>=0);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      let at=enabled.indexOf(active);
      if(event.key==='Home')at=0;else if(event.key==='End')at=enabled.length-1;
      else if(event.key==='ArrowDown')at=(at+1)%enabled.length;
      else at=at<0?enabled.length-1:(at+enabled.length-1)%enabled.length;
      select(enabled[at]??-1);
    }else if(event.key==='Enter'||event.key===' '||event.key==='Spacebar')activate(active>=0?active:enabled[0]);
  },true);
  listen(doc,'pointerdown',event=>{if(!element.hidden&&!element.contains(event.target))close();},true);
  listen(doc,'contextmenu',event=>{if(!root.contains(event.target)&&!element.contains(event.target))close();},true);
  listen(doc,'scroll',event=>{if(!element.contains(event.target))close();},true);
  listen(win,'resize',()=>close());listen(win,'blur',()=>close());
  return {element,close:()=>close(),dispose(){if(disposed)return;close();disposed=true;for(const remove of listeners)remove();element.remove();items=[];}};
}
