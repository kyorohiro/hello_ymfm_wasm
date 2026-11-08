// SPDX-License-Identifier: BSD-3-Clause
// DOM-only view for the owned SID preview/capture controller.
export function createSidImportPanel({root,getController}) {
  let selectionToken=null;
  const $=id=>root.querySelector('#'+id),listeners=[];
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
  const message=(text,error=false)=>{ $('sidImportStatus').textContent=text;$('sidImportStatus').dataset.error=String(error);if(error)$('sidImportStatus').dataset.state='error'; };
  const act=(node,callback)=>listen(node,'click',()=>{
    node.blur();try{Promise.resolve(callback()).catch(error=>message(error?.message??String(error),true));}
    catch(error){message(error?.message??String(error),true);}
  });
  act($('loadSidSound'),()=>{selectionToken=getController().beginFileSelection();$('sidSoundFileInput').click();});
  listen($('sidSoundFileInput'),'cancel',()=>{const token=selectionToken;selectionToken=null;$('sidSoundFileInput').blur();getController().cancelFileSelection(token??undefined);});
  listen($('sidSoundFileInput'),'change',()=>{
    const file=$('sidSoundFileInput').files?.[0],token=selectionToken;selectionToken=null;$('sidSoundFileInput').value='';$('sidSoundFileInput').blur();
    if(!file){getController().cancelFileSelection(token??undefined);return;}
    void getController().loadFile(file,token===null?undefined:{selectionToken:token}).catch(error=>message(error?.message??String(error),true));
  });
  for(const [id,method]of [['sidImportPlay','play'],['sidImportStop','stop'],['sidImportCapture','capture'],['sidImportUse','useVoice']])act($(id),()=>getController()[method]());
  for(const [id,delta]of [['sidImportSubtuneDown',-1],['sidImportSubtuneUp',1]])act($(id),()=>{
    const selection=getController().read().selection;if(selection)return getController().setSubtune(selection.subtune+delta);
  });
  for(const button of root.querySelectorAll('[data-sid-import-model]'))act(button,()=>getController().setModel(button.dataset.sidImportModel));
  for(const button of root.querySelectorAll('[data-sid-import-voice]'))act(button,()=>getController().selectVoice(Number(button.dataset.sidImportVoice)));
  // Opening/closing a disclosure with the pointer must not retain performance focus.
  listen(root.querySelector('summary'),'click',event=>{if(event.detail)event.currentTarget.blur();});
  return {
    update(state){
      const selection=state.selection,busy=Boolean(state.busy),row=state.selected;
      $('sidImportPlay').disabled=state.canPlay===undefined?!selection||busy||state.playing:!state.canPlay;
      $('sidImportStop').disabled=state.canStop===undefined?!state.playing&&!state.starting&&!state.loading&&!busy:!state.canStop;
      $('sidImportCapture').disabled=state.canCapture===undefined?!state.playing||busy:!state.canCapture;
      $('sidImportUse').disabled=state.canUse===undefined?!row?.available||busy:!state.canUse;
      $('sidImportUse').textContent=`Use Voice ${(state.voice??0)+1}`;
      $('sidImportSubtuneDown').disabled=!selection||busy||selection.subtune<=1;
      $('sidImportSubtuneUp').disabled=!selection||busy||selection.subtune>=selection.songs;
      $('sidImportSubtuneValue').textContent=selection?`${selection.subtune} / ${selection.songs}`:'—';
      $('sidImportInfo').textContent=selection
        ?`${selection.name} · ${selection.title||selection.name} · ${selection.format} · ${selection.timing} · PAL / ${selection.model}${selection.model==='8580'?' Preview':''}`
        :'Open a SID file, play the song, then capture a voice for this keyboard.';
      message(state.message??'Choose a local SID file.',Boolean(state.error));
      $('sidImportStatus').dataset.state=state.error?'error':state.loading?'loading':state.starting?'starting':state.playing?'playing':state.snapshot?'captured':selection?'ready':'idle';
      for(const button of root.querySelectorAll('[data-sid-import-model]')){
        button.setAttribute('aria-pressed',String(button.dataset.sidImportModel===(selection?.modelSelection??state.modelSelection??'auto')));
        button.disabled=busy;
      }
      for(const button of root.querySelectorAll('[data-sid-import-voice]')){
        const voice=Number(button.dataset.sidImportVoice),candidate=state.snapshot?.voices?.[voice];
        button.disabled=!state.snapshot||busy;button.setAttribute('aria-pressed',String(voice===state.voice));
        button.dataset.available=String(Boolean(candidate?.available));
        button.textContent=`Voice ${voice+1}${candidate?candidate.available?' · '+candidate.preset.voice.waveform:' · unavailable':''}`;
      }
      $('sidImportVoicePreview').dataset.unavailable=String(Boolean(row&&!row.available));
      if(!row)$('sidImportVoicePreview').textContent='No snapshot captured.';
      else if(!row.available)$('sidImportVoicePreview').textContent=row.reason;
      else{
        const p=row.preset,pair=row.pair;
        $('sidImportVoicePreview').textContent=
          `${state.snapshot.name} · Subtune ${state.snapshot.subtune} · Voice ${(state.voice??0)+1}\n`+
          `${p.model} · ${p.voice.waveform} · ADSR ${[p.voice.attack,p.voice.decay,p.voice.sustain,p.voice.release].join(' / ')}\n`+
          `Filter ${p.filter.enabled?p.filter.mode:'bypassed'} · Cutoff ${p.filter.cutoff} · Resonance ${p.filter.resonance}`+
          (pair?`\nVoice ${pair.sourceVoice+1} → ${pair.carrierVoice+1} · ${[pair.sync&&'Sync',pair.ring&&'Ring'].filter(Boolean).join(' + ')} · Ratio ≈${Number(pair.ratio.toPrecision(8))}×`:'')+
          (row.warnings.length?'\n'+row.warnings.join(' '):'');
      }
      $('sidImportPlay').textContent=state.starting?'Preparing…':state.playing?'Playing…':'Play song';
      $('sidImportCapture').textContent=state.capturing?'Capturing…':'Capture voices';
      root.setAttribute('aria-busy',String(busy));
    },
    dispose(){for(const remove of listeners)remove();},
  };
}
