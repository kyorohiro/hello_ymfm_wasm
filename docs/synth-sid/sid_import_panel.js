// SPDX-License-Identifier: BSD-3-Clause
// DOM-only view for the owned SID preview/capture controller.
export function createSidImportPanel({root,liveRoot,getController}) {
  let selectionToken=null;
  const $=id=>root.querySelector('#'+id),listeners=[];
  const listen=(node,event,fn)=>{node.addEventListener(event,fn);listeners.push(()=>node.removeEventListener(event,fn));};
  // Live observations arrive while the pointer may still be held down. Keep
  // unchanged labels (and their text nodes) intact so Safari can finish a click.
  const label=(node,text)=>{if(node.textContent!==text)node.textContent=text;};
  const message=(text,error=false)=>{const node=$('sidImportStatus');if(node.textContent!==text)node.textContent=text;node.dataset.error=String(error);if(error)node.dataset.state='error';};
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
  for(const [id,method]of [['sidImportPlay','play'],['sidImportStop','stop'],['sidImportCapture','capture']])act($(id),()=>getController()[method]());
  act($('sidImportPause'),()=>{const control=getController();return control.read().paused?control.resume():control.pause();});
  for(const [id,delta]of [['sidImportSubtuneDown',-1],['sidImportSubtuneUp',1]])act($(id),()=>{
    const selection=getController().read().selection;if(selection)return getController().setSubtune(selection.subtune+delta);
  });
  for(const button of root.querySelectorAll('[data-sid-import-model]'))act(button,()=>getController().setModel(button.dataset.sidImportModel));
  for(const button of root.querySelectorAll('[data-sid-import-voice]'))act(button,()=>getController().selectVoice(Number(button.dataset.sidImportVoice)));
  const follow=liveRoot.querySelector('#sidLiveEnabled');
  listen(follow,'change',()=>{getController().setLiveEnabled(follow.checked);follow.blur();});
  // Opening/closing a disclosure with the pointer must not retain performance focus.
  listen(root.querySelector('summary'),'click',event=>{if(event.detail)event.currentTarget.blur();});
  return {
    update(state){
      const selection=state.selection,busy=Boolean(state.busy),row=state.selected;
      $('sidImportPlay').disabled=state.canPlay===undefined?!selection||busy||state.playing:!state.canPlay;
      $('sidImportStop').disabled=state.canStop===undefined?!state.playing&&!state.starting&&!state.loading&&!busy:!state.canStop;
      $('sidImportCapture').disabled=state.canCapture===undefined?!state.playing||busy:!state.canCapture;
      $('sidImportPause').disabled=!(state.canPause||state.canResume);
      label($('sidImportPause'),state.pausing?'Pausing…':state.resuming?'Resuming…':state.paused?'Resume':'Pause');
      $('sidImportSubtuneDown').disabled=!selection||busy||selection.subtune<=1;
      $('sidImportSubtuneUp').disabled=!selection||busy||selection.subtune>=selection.songs;
      label($('sidImportSubtuneValue'),selection?`${selection.subtune} / ${selection.songs}`:'—');
      const snapshot=state.snapshot;
      const captureInfo=snapshot
        ?`Captured: ${snapshot.name} · Subtune ${snapshot.subtune} · ${(snapshot.positionFrames/snapshot.sampleRate).toFixed(3)} s. Select a Voice to load these fixed settings and stop the song.`
        :'No snapshot yet. Capture voices, then select a Voice to load it into this keyboard.';
      label($('sidImportCaptureInfo'),captureInfo);
      label($('sidImportInfo'),selection
        ?`${selection.name} · ${selection.title||selection.name} · ${selection.format} · ${selection.timing} · PAL / ${selection.model}${selection.model==='8580'?' Preview':''}`
        :'Open a SID file, play the song, then capture a voice for this keyboard.');
      message(state.message??'Choose a local SID file.',Boolean(state.error));
      $('sidImportStatus').dataset.state=state.error?'error':state.loading?'loading':state.starting?'starting':state.pausing?'pausing':state.resuming?'resuming':state.paused?'paused':state.playing?'playing':state.snapshot?'captured':selection?'ready':'idle';
      for(const button of root.querySelectorAll('[data-sid-import-model]')){
        button.setAttribute('aria-pressed',String(button.dataset.sidImportModel===(selection?.modelSelection??state.modelSelection??'auto')));
        button.disabled=busy;
      }
      for(const button of root.querySelectorAll('[data-sid-import-voice]')){
        const voice=Number(button.dataset.sidImportVoice),candidate=state.snapshot?.voices?.[voice];
        button.disabled=!state.snapshot||busy;button.setAttribute('aria-pressed',String(voice===state.voice));
        button.dataset.available=String(Boolean(candidate?.available));
        label(button,`Voice ${voice+1}${candidate?candidate.available?' · '+candidate.preset.voice.waveform:' · unavailable':''}`);
      }
      follow.checked=state.liveEnabled;
      $('sidImportVoicePreview').dataset.unavailable=String(Boolean(row&&!row.available));
      if(!row)label($('sidImportVoicePreview'),'No snapshot captured.');
      else if(!row.available)label($('sidImportVoicePreview'),row.reason);
      else{
        const p=row.preset,pair=row.pair;
        label($('sidImportVoicePreview'),
          `${state.snapshot.name} · Subtune ${state.snapshot.subtune} · Voice ${(state.voice??0)+1}\n`+
          `${p.model} · ${p.voice.waveform} · ADSR ${[p.voice.attack,p.voice.decay,p.voice.sustain,p.voice.release].join(' / ')}\n`+
          `Filter ${p.filter.enabled?p.filter.mode:'bypassed'} · Cutoff ${p.filter.cutoff} · Resonance ${p.filter.resonance}`+
          (pair?`\nVoice ${pair.sourceVoice+1} → ${pair.carrierVoice+1} · ${[pair.sync&&'Sync',pair.ring&&'Ring'].filter(Boolean).join(' + ')} · Ratio ≈${Number(pair.ratio.toPrecision(8))}×`:'')+
          (row.warnings.length?'\n'+row.warnings.join(' '):''));
      }
      label($('sidImportPlay'),state.starting?'Preparing…':state.playing?'Playing…':'Play song');
      label($('sidImportCapture'),state.capturing?'Capturing…':'Capture voices');
      root.setAttribute('aria-busy',String(busy));
    },
    dispose(){for(const remove of listeners)remove();},
  };
}
