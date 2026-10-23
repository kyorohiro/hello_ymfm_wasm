import {createPlaygroundOperatorTab} from './playground_operator_tab.js?v=native-extra-ym2612-1';

/** Reuse the OPN editor for connected additional FM instances. Reads happen on
 * selection, visible state notifications and explicit Refresh; no polling. */
export function createPlaygroundExtraFmEditor({root,primaryRoot,primaryEditor,primaryKind,button,
  getInspector,presets,presetOrder,onAvailability,onTargetChange,onStatus=()=>{}}) {
  const doc=root.ownerDocument,toolbar=doc.createElement('div'),label=doc.createElement('label'),select=doc.createElement('select');
  toolbar.className='operator-toolbar';toolbar.dataset.extraFmToolbar='';label.textContent='Sound chip ';
  select.setAttribute('aria-label','OPN sound chip');select.dataset.opnInstance='';label.append(select);
  const refreshButton=doc.createElement('button');refreshButton.type='button';refreshButton.textContent='Refresh';
  const status=doc.createElement('span');status.className='subtext';status.setAttribute('role','status');
  toolbar.append(label,refreshButton,status);root.prepend(toolbar);
  const extraRoot=doc.createElement('div');extraRoot.dataset.extraFmEditor='';extraRoot.hidden=true;root.append(extraRoot);
  let disposed=false,visible=false,selected='',editor=null,source=null,connection=null,version=0,reading=null,signature='',editState={count:0,revision:0};
  const presetOptions=new Map();
  function current(id=selected,s=source,c=connection,v=version){
    try{return !disposed&&selected===id&&source===s&&version===v&&getInspector()===s&&s?.getConnectionToken(id)===c;}
    catch{return false;}
  }
  function report(error){if(error?.name!=='AbortError'&&!disposed){status.textContent=error.message??String(error);onStatus(status.textContent);}}
  function publishTarget(){onTargetChange(visible&&selected&&editor?{kind:'ym2612',id:selected,channel:`fm:${editor.getSelectedChannel()}`} : null);}
  function visibility(){primaryRoot.hidden=Boolean(selected)||!primaryEditor;extraRoot.hidden=!selected;
    primaryEditor?.setVisible(visible&&!selected);editor?.setVisible(visible&&Boolean(selected));publishTarget();}
  function sync(snapshot){
    const fm=snapshot.fmState;if(!fm||!Array.isArray(fm.channels)||fm.channels.length!==6)throw new Error('Additional YM2612 returned invalid FM state');
    for(let ch=0;ch<6;ch++){
      const c=fm.channels[ch];
      if(!Array.isArray(c?.operators)||c.operators.length!==4)throw new Error('Additional YM2612 returned invalid operator state');
      editor.syncPreset(ch,'',{algorithm:c.algorithm,feedback:c.feedback,ams:c.ams,pms:c.pms,pan:{left:c.left,right:c.right},operators:c.operators});
    }
    editor.syncLfo(fm.lfo.enabled,fm.lfo.frequency);editor.syncDacEnabled(Boolean(snapshot.registers[0][0x2b]&128));
    editor.syncChannel3SpecialMode(Boolean(snapshot.registers[0][0x27]&64));
    for(const [op,pitch]of (fm.channels[2].specialFrequencies??[]).entries())editor.syncChannel3SpecialFrequency(op,pitch.block,pitch.fnum);
  }
  function refresh(){
    if(disposed||!visible||!selected||!editor||reading)return reading??Promise.resolve();
    const id=selected,s=source,c=connection,v=version,edits=editState,revision=edits.revision;
    const work=Promise.resolve().then(()=>{if(!current(id,s,c,v))throw new DOMException('Sound chip changed','AbortError');return s.read(id);})
      .then(snapshot=>{if(current(id,s,c,v)&&revision===edits.revision&&!edits.count){sync(snapshot);status.textContent='';}}).catch(error=>{if(current(id,s,c,v))report(error);})
      .finally(()=>{if(reading===work){reading=null;if(visible&&!edits.count&&revision!==edits.revision&&current(id,s,c,v))void refresh();}});reading=work;return work;
  }
  function edit(method,args,{id,s,c,v,edits}){
    if(!current(id,s,c,v))return Promise.resolve();
    edits.count++;edits.revision++;
    return Promise.resolve().then(()=>{if(!current(id,s,c,v))throw new DOMException('Sound chip changed','AbortError');return s.invoke(id,method,args);})
      .catch(error=>{if(current(id,s,c,v))report(error);}).finally(()=>{edits.count--;if(current(id,s,c,v)&&!edits.count)void refresh();});
  }
  function choose(id){
    if(disposed)return;
    version++;selected=id;reading=null;editState={count:0,revision:0};editor?.dispose();editor=null;extraRoot.replaceChildren();source=getInspector();
    try{connection=id?source.getConnectionToken(id):null;}
    catch{selected=id='';connection=null;}
    if(id){
      editor=createPlaygroundOperatorTab({root:extraRoot,presets,presetOrder,channelCount:6,supportsDac:true,idPrefix:'extraFm-',onStatus});
      for(const [key,label]of presetOptions)editor.registerPresetOption(key,label);
      const target={id,s:source,c:connection,v:version,edits:editState};
      const facade=Object.fromEntries(['setOperator','setAlgo','setPan','setLfo','setDacEnabled','setChannel3SpecialMode',
        'setChannel3SpecialFrequency','setFrequency'].map(method=>[method,(...args)=>{void edit(method,args,target);} ]));
      editor.attachSynth(facade);
    }
    select.value=id;visibility();void refresh();
  }
  function update(){
    if(disposed)return;
    const s=getInspector(),entries=(s?.list()??[]).filter(entry=>entry.kind==='ym2612'&&entry.additional===true&&entry.connected!==false)
      .flatMap(entry=>{try{return [{...entry,connection:s.getConnectionToken(entry.id)}];}catch{return [];}});
    const next=JSON.stringify(entries.map(entry=>[entry.id,entry.connection]));
    onAvailability(Boolean(entries.length));if(button&&!primaryEditor)button.textContent='YM2612';
    toolbar.hidden=entries.length===0;
    if(signature!==next||s!==source){
      signature=next;const choices=[...(primaryEditor?[['',`${primaryKind.toUpperCase()} · Primary`]]:[]),...entries.map(entry=>[entry.id,`YM2612 · ${entry.id}`])];
      if(!choices.length)choices.push(['','No additional YM2612 connected']);
      select.replaceChildren(...choices.map(([id,text])=>{const op=doc.createElement('option');op.value=id;op.textContent=text;return op;}));
      const id=choices.some(([id])=>id===selected)?selected:primaryEditor?'':entries[0]?.id??'';
      const token=entries.find(entry=>entry.id===id)?.connection??null;
      if(id!==selected||s!==source||token!==connection)choose(id);else select.value=id;
    }
    if(visible&&!editState.count)void refresh();
  }
  select.addEventListener('change',()=>choose(select.value));refreshButton.addEventListener('click',()=>{void refresh();});
  extraRoot.addEventListener('change',publishTarget);extraRoot.addEventListener('click',publishTarget);
  const unsubscribe=getInspector()?.subscribe(update);update();
  return {
    setVisible(value){if(disposed)return;visible=Boolean(value);update();visibility();},
    isExtraSelected:()=>Boolean(selected),getEditor:()=>selected?editor:primaryEditor,
    registerPresetOption(id,label){presetOptions.set(id,label);editor?.registerPresetOption(id,label);},
    removePresetOption(id){presetOptions.delete(id);editor?.removePresetOption(id);},
    dispose(){if(disposed)return;disposed=true;version++;unsubscribe?.();editor?.dispose();toolbar.remove();extraRoot.remove();onTargetChange(null);},
  };
}
