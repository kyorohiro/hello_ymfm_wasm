import {createPlaygroundOperatorTab} from './playground_operator_tab.js?v=native-extra-gameboy-1';
import {createPlaygroundOpnSsgEditor} from './playground_opn_ssg_editor.js?v=native-extra-gameboy-1';
import {createPlaygroundOpnbSampleEditor} from './playground_opnb_sample_editor.js?v=native-extra-gameboy-1';
import {createPlaygroundOpnaSampleEditor} from './playground_opna_sample_editor.js?v=native-extra-gameboy-1';

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
  let disposed=false,visible=false,selected='',kind='ym2612',editor=null,ssgEditor=null,sampleEditor=null,section='fm',source=null,connection=null,version=0,reading=null,signature='',editState={count:0,revision:0};
  const channelCount=()=>kind==='ym2203'?3:kind==='ym2610'?4:6;
  const presetOptions=new Map();
  function current(id=selected,s=source,c=connection,v=version){
    try{return !disposed&&selected===id&&source===s&&version===v&&getInspector()===s&&s?.getConnectionToken(id)===c;}
    catch{return false;}
  }
  function report(error){if(error?.name!=='AbortError'&&!disposed){status.textContent=error.message??String(error);onStatus(status.textContent);}}
  function publishTarget(){onTargetChange(visible&&selected&&editor?{kind,id:selected,channel:section==='ssg'&&ssgEditor?`ssg:${ssgEditor.getSelectedChannel()}`:section==='sample'&&sampleEditor?sampleEditor.getSelectedTarget():`fm:${editor.getSelectedChannel()}`} : null);}
  function visibility(){primaryRoot.hidden=Boolean(selected)||!primaryEditor;extraRoot.hidden=!selected;
    if(button)button.textContent=selected?kind.toUpperCase():primaryEditor?primaryKind.toUpperCase():'OPN';
    primaryEditor?.setVisible(visible&&!selected);editor?.setVisible(visible&&Boolean(selected));publishTarget();}
  function sync(snapshot){
    const fm=snapshot.fmState;if(!fm||!Array.isArray(fm.channels)||fm.channels.length!==channelCount())throw new Error(`Additional ${kind.toUpperCase()} returned invalid FM state`);
    for(let ch=0;ch<channelCount();ch++){
      const c=fm.channels[ch];
      if(!Array.isArray(c?.operators)||c.operators.length!==4)throw new Error(`Additional ${kind.toUpperCase()} returned invalid operator state`);
      editor.syncPreset(ch,'',{algorithm:c.algorithm,feedback:c.feedback,ams:c.ams,pms:c.pms,pan:{left:c.left,right:c.right},operators:c.operators});
    }
    if(kind!=='ym2203')editor.syncLfo(fm.lfo.enabled,fm.lfo.frequency);
    if(kind==='ym2612')editor.syncDacEnabled(Boolean(snapshot.registers[0][0x2b]&128));
    editor.syncChannel3SpecialMode(Boolean(snapshot.registers[0][0x27]&64));
    for(const [op,pitch]of (fm.channels[kind==='ym2610'?1:2].specialFrequencies??[]).entries())editor.syncChannel3SpecialFrequency(op,pitch.block,pitch.fnum);
    ssgEditor?.update(snapshot);
    sampleEditor?.update(snapshot);
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
    version++;selected=id;reading=null;editState={count:0,revision:0};editor?.dispose();ssgEditor?.dispose();sampleEditor?.dispose();editor=null;ssgEditor=null;sampleEditor=null;section='fm';extraRoot.replaceChildren();source=getInspector();
    try{connection=id?source.getConnectionToken(id):null;kind=source.list().find(entry=>entry.id===id)?.kind??'ym2612';}
    catch{selected=id='';connection=null;}
    if(id){
      if(kind==='ym2610'){const note=doc.createElement('p');note.className='subtext';note.textContent='FM 1–4 map to hardware channels 2, 3, 5, 6. CH3SP controls FM 2.';extraRoot.append(note);}
      const fmRoot=doc.createElement('div');extraRoot.append(fmRoot);
      editor=createPlaygroundOperatorTab({root:fmRoot,presets,presetOrder,channelCount:channelCount(),supportsDac:kind==='ym2612',idPrefix:'extraFm-',onStatus});
      for(const [key,label]of presetOptions)editor.registerPresetOption(key,label);
      const target={id,s:source,c:connection,v:version,edits:editState};
      const facade=Object.fromEntries(['setOperator','setAlgo','setPan','setLfo','setDacEnabled','setChannel3SpecialMode',
        'setChannel3SpecialFrequency','setFrequency'].map(method=>[method,(...args)=>{void edit(method,args,target);} ]));
      if(kind==='ym2203'){facade.supportsPan=false;facade.supportsLfo=false;}
      editor.attachSynth(facade);
      if(['ym2203','ym2608','ym2610'].includes(kind)){
        const ssgRoot=doc.createElement('div');extraRoot.append(ssgRoot);
        ssgEditor=createPlaygroundOpnSsgEditor({root:ssgRoot,onEdit:(method,args)=>{void edit(method,args,target);},onTargetChange:()=>{if(current(target.id,target.s,target.c,target.v)){section='ssg';publishTarget();}}});
      }
      if(kind==='ym2608'||kind==='ym2610'){
        const sampleRoot=doc.createElement('div');extraRoot.append(sampleRoot);
        sampleEditor=(kind==='ym2610'?createPlaygroundOpnbSampleEditor:createPlaygroundOpnaSampleEditor)({root:sampleRoot,onEdit:(method,args)=>{void edit(method,args,target);},onTargetChange:()=>{if(current(target.id,target.s,target.c,target.v)){section='sample';publishTarget();}}});
      }
    }
    select.value=id;visibility();void refresh();
  }
  function update(){
    if(disposed)return;
    const s=getInspector(),entries=(s?.list()??[]).filter(entry=>['ym2612','ym2203','ym2608','ym2610'].includes(entry.kind)&&entry.additional===true&&entry.connected!==false)
      .flatMap(entry=>{try{return [{...entry,connection:s.getConnectionToken(entry.id)}];}catch{return [];}});
    const next=JSON.stringify(entries.map(entry=>[entry.id,entry.kind,entry.connection]));
    onAvailability(Boolean(entries.length));
    toolbar.hidden=entries.length===0;
    if(signature!==next||s!==source){
      signature=next;const choices=[...(primaryEditor?[['',`${primaryKind.toUpperCase()} · Primary`]]:[]),...entries.map(entry=>[entry.id,`${entry.kind.toUpperCase()} · ${entry.id}`])];
      if(!choices.length)choices.push(['','No additional OPN connected']);
      select.replaceChildren(...choices.map(([id,text])=>{const op=doc.createElement('option');op.value=id;op.textContent=text;return op;}));
      const id=choices.some(([id])=>id===selected)?selected:primaryEditor?'':entries[0]?.id??'';
      const token=entries.find(entry=>entry.id===id)?.connection??null;
      if(id!==selected||s!==source||token!==connection)choose(id);else select.value=id;
    }
    if(visible&&!editState.count)void refresh();
  }
  select.addEventListener('change',()=>choose(select.value));refreshButton.addEventListener('click',()=>{void refresh();});
  function selectSection(event){section=event.target?.closest?.('[data-extra-ssg-editor]')?'ssg':event.target?.closest?.('[data-extra-opna-editor], [data-extra-opnb-editor]')?'sample':'fm';publishTarget();}
  extraRoot.addEventListener('change',selectSection);extraRoot.addEventListener('click',selectSection);
  const unsubscribe=getInspector()?.subscribe(update);update();
  return {
    setVisible(value){if(disposed)return;visible=Boolean(value);update();visibility();},
    isExtraSelected:()=>Boolean(selected),getEditor:()=>selected?editor:primaryEditor,
    getChannelCount:()=>selected?channelCount():null,
    registerPresetOption(id,label){presetOptions.set(id,label);editor?.registerPresetOption(id,label);},
    removePresetOption(id){presetOptions.delete(id);editor?.removePresetOption(id);},
    dispose(){if(disposed)return;disposed=true;version++;unsubscribe?.();editor?.dispose();ssgEditor?.dispose();sampleEditor?.dispose();toolbar.remove();extraRoot.remove();onTargetChange(null);},
  };
}
