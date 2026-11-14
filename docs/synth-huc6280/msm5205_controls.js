// SPDX-License-Identifier: BSD-3-Clause
// The authored ADPCM sample, independent of the VGM reference decoder.
const hostTimeout=globalThis.setTimeout.bind(globalThis),hostClearTimeout=globalThis.clearTimeout.bind(globalThis);
const rateHz=rate=>1536000/(48*(16-rate));
const rawPath=path=>/\.(?:adpcm|adp|msm|msm5205|bin)$/i.test(path);
const wavPath=path=>/\.wav$/i.test(path);
export const isMsm5205SamplePath=path=>typeof path==='string'&&(wavPath(path)||rawPath(path));

export function setupMsm5205Controls({root,source,project,addFiles,onStatus=()=>{},onOutput=()=>{},beforePlay=()=>{},afterPlay=()=>{},isVisible=()=>!root.hidden}={}){
  const doc=root.ownerDocument,win=doc.defaultView??globalThis,$=id=>root.querySelector('#'+id),listeners=[];
  const select=$('msmSampleSelect'),format=$('msmSampleFormat'),load=$('msmLoadSample'),cancel=$('msmCancelLoad');
  const play=$('msmPlay'),stop=$('msmStop'),loop=$('msmLoop'),rate=$('msmRate'),hz=$('msmRateHz');
  const info=$('msmSampleInfo'),capacity=$('msmSampleCapacity'),stateNode=$('msmSourceState'),status=$('msmSourceStatus');
  const hint=$('msmNextPlayHint'),canvas=$('msmSampleWave'),ctx=canvas.getContext('2d');
  let disposed=false,selected=null,signature='',lastWave=null,loading=null,loadSerial=0,drag=null,timer=null,polling=false,localError='',lastRevision=-1,playPending=false,playSerial=0;
  const listen=(node,type,fn)=>{node.addEventListener(type,fn);listeners.push(()=>node.removeEventListener(type,fn));};
  const report=error=>{if(disposed||error?.name==='AbortError')return;localError=error?.message??String(error);render();onStatus('MSM5205: '+localError,true);};
  const entries=()=>project.listEntries().filter(entry=>entry.fileType==='binary'&&isMsm5205SamplePath(entry.path));
  function cancelPlay(){playSerial++;playPending=false;render();}
  function cancelPending({all=false}={}){loadSerial++;loading?.controller.abort();loading=null;if(all)source.cancelLoad();}
  function refreshFiles(){
    if(disposed)return;
    const files=entries(),nextSignature=JSON.stringify(files.map(file=>[file.path,file.revision]));
    if(loading&&!files.some(file=>file.path===loading.path&&file.revision===loading.revision))cancelPending();
    if(signature!==nextSignature){
      signature=nextSignature;const placeholder=doc.createElement('option');placeholder.value='';placeholder.textContent=files.length?'Choose a sample…':'No WAV / ADPCM files';placeholder.disabled=true;
      select.replaceChildren(placeholder,...files.map(file=>{const option=doc.createElement('option');option.value=file.path;option.textContent=file.path.slice(1);return option;}));
    }
    const previous=selected;
    selected=files.some(file=>file.path===project.selectedPath)?project.selectedPath:files.some(file=>file.path===selected)?selected:files[0]?.path??null;
    select.value=selected??'';if(previous!==selected)format.value=selected&&wavPath(selected)?'wav':'adpcm';render();
  }
  function draw(){
    if(!ctx||disposed)return;const value=source.read(),wave=value.asset?.wave;
    const width=Math.max(280,Math.round(canvas.getBoundingClientRect().width||900)),height=180,dpr=Math.min(2,win.devicePixelRatio||1);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#192128';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#526069';ctx.lineWidth=1;
    for(const y of [16,height/2,height-16]){ctx.beginPath();ctx.moveTo(12,y);ctx.lineTo(width-12,y);ctx.stroke();}
    canvas.dataset.binCount=String(wave?.bins.length??0);canvas.dataset.peak=String(wave?.peak??0);
    if(!wave){ctx.fillStyle='#aebdc7';ctx.font='13px sans-serif';ctx.fillText('Load a sample to view decoded ADPCM.',18,height/2-12);return;}
    ctx.strokeStyle='#78c9ed';ctx.lineWidth=1.5;ctx.beginPath();
    wave.bins.forEach((bin,index)=>{const x=12+(index+.5)/wave.bins.length*(width-24),scale=(height-32)/2;ctx.moveTo(x,height/2-bin.max*scale);ctx.lineTo(x,height/2-bin.min*scale);});ctx.stroke();
  }
  function render(){
    if(disposed)return;const value=source.read(),asset=value.asset,actual=value.actual;
    if(lastRevision!==value.revision){lastRevision=value.revision;localError='';}
    const dataset={sourceId:value.sourceId,revision:value.revision,sourceState:value.state,busy:value.busy,playPending,assetBytes:asset?.info.bytes??0,assetFrames:asset?.info.frames??0,assetPath:asset?.path??asset?.info.path??'',defaultRate:value.defaults.rate,defaultLoop:value.defaults.loop,activeRate:actual?.rate??'',activeLoop:actual?.loop??''};
    for(const node of [root,stateNode])for(const[key,item]of Object.entries(dataset))node.dataset[key]=String(item);
    rate.textContent=String(value.defaults.rate);rate.setAttribute('aria-valuenow',String(value.defaults.rate));
    hz.textContent=`${rateHz(value.defaults.rate).toLocaleString('en-US',{maximumFractionDigits:1})} Hz`;
    loop.checked=value.defaults.loop;
    root.querySelector('[data-msm-rate-delta="-1"]').disabled=value.defaults.rate===0;
    root.querySelector('[data-msm-rate-delta="1"]').disabled=value.defaults.rate===15;
    load.disabled=!selected||value.busy;cancel.hidden=!value.busy;
    play.disabled=!asset||value.busy||playPending;stop.disabled=!(playPending||value.busy||value.state==='playing');
    play.textContent=value.state==='playing'?'Replay':'Play';
    capacity.value=asset?.info.bytes??0;
    info.textContent=asset?`${asset.name??asset.info.name} · ${asset.info.bytes.toLocaleString()} / 65,536 bytes · ${asset.info.frames.toLocaleString()} samples${asset.info.paddedFrames!==asset.info.frames?` (${asset.info.paddedFrames.toLocaleString()} packed)`:''} · ${(asset.info.frames/rateHz(value.defaults.rate)).toFixed(3)} s at the selected Rate`:'No sample loaded · choose a WAV or packed ADPCM file from Files.';
    stateNode.textContent=playPending?'Starting…':value.busy?'Preparing sample…':value.state==='playing'?`Playing${actual?.mode==='raw'?' · raw register input':''}`:value.state==='ended'?'Finished':asset?'Ready':'Empty';
    status.textContent=localError||value.error||'';status.dataset.error=String(Boolean(localError||value.error));
    hint.textContent='Rate and Loop apply on the next Play. Replay starts from the beginning.'+(value.state==='playing'&&actual?` Playing: Rate ${actual.rate} · ${rateHz(actual.rate).toLocaleString('en-US',{maximumFractionDigits:1})} Hz · Loop ${actual.loop?'On':'Off'}.`:'');
    const waveKey=asset?`${value.sourceId}:${value.revision}`:'empty';
    if(lastWave!==waveKey){lastWave=waveKey;draw();}
    schedulePoll();
  }
  function schedulePoll(){
    if(disposed||timer!==null||polling||source.read().state!=='playing'||doc.hidden)return;
    timer=hostTimeout(async()=>{timer=null;if(disposed)return;polling=true;try{await source.getState();}catch(error){report(error);}finally{polling=false;if(!disposed){render();onOutput();}}},isVisible()?100:300);
  }
  async function loadSelected(){
    if(disposed||!selected)return false;
    const entry=entries().find(file=>file.path===selected),file=project.fs.get(selected);if(!entry||file?.type!=='binary')return false;
    cancelPending();const serial=++loadSerial,controller=new AbortController(),path=selected;loading={controller,path,revision:entry.revision};localError='';
    try{
      const options={name:path.split('/').pop(),path,rate:source.read().defaults.rate,signal:controller.signal};
      await source[format.value==='wav'?'loadSample':'loadMemory'](file.data,options);
      if(disposed||serial!==loadSerial||controller.signal.aborted)return false;
      onStatus(`Loaded ${path} into MSM5205 · press Play to hear it. Code and HuC6280 continue.`);return true;
    }catch(error){if(serial===loadSerial)report(error);return false;}
    finally{if(serial===loadSerial){loading=null;render();}}
  }
  function setRate(value){localError='';try{source.setDefaults({rate:Math.max(0,Math.min(15,Math.round(value)))});}catch(error){report(error);}}
  listen(select,'change',()=>{select.blur();cancelPending();selected=select.value;format.value=wavPath(selected)?'wav':'adpcm';localError='';project.select(selected);render();});
  listen(format,'change',()=>{format.blur();localError='';});
  listen(load,'click',()=>{load.blur();void loadSelected();});
  listen(cancel,'click',()=>{cancel.blur();cancelPending({all:true});localError='';render();onStatus('MSM5205 load cancelled · previous sample kept.');});
  listen($('msmAddFiles'),'click',()=>{doc.activeElement?.blur?.();addFiles();});
  listen(play,'click',()=>{
    play.blur();localError='';const serial=++playSerial;playPending=true;render();
    void(async()=>{
      // Synchronous gesture guards must not defer capturing the source's
      // operation token beyond a later Stop in this same event turn.
      const readiness=beforePlay();if(readiness&&typeof readiness.then==='function')await readiness;
      if(disposed||serial!==playSerial)return;
      await source.play();if(disposed||serial!==playSerial)return;
      await afterPlay();onOutput();
    })().catch(error=>{if(serial===playSerial)report(error);}).finally(()=>{if(!disposed&&serial===playSerial){playPending=false;render();}});
  });
  listen(stop,'click',()=>{stop.blur();cancelPlay();cancelPending({all:true});localError='';void source.stop().then(onOutput).catch(report);});
  listen(loop,'change',()=>{loop.blur();localError='';try{source.setDefaults({loop:loop.checked});}catch(error){report(error);}});
  for(const button of root.querySelectorAll('[data-msm-rate-delta]')){
    listen(button,'pointerdown',event=>{if(event.button===0){event.preventDefault();doc.activeElement?.blur?.();}});
    listen(button,'click',()=>{button.blur();setRate(source.read().defaults.rate+Number(button.dataset.msmRateDelta));});
  }
  listen(rate,'keydown',event=>{const current=source.read().defaults.rate;
    const next=event.key==='Home'?0:event.key==='End'?15:['ArrowUp','ArrowRight'].includes(event.key)?current+1:['ArrowDown','ArrowLeft'].includes(event.key)?current-1:event.key==='PageUp'?current+5:event.key==='PageDown'?current-5:null;
    if(next===null)return;event.preventDefault();event.stopPropagation();setRate(next);
  });
  listen(rate,'pointerdown',event=>{if(event.button!==0)return;event.preventDefault();doc.activeElement?.blur?.();drag={id:event.pointerId,x:event.clientX,value:source.read().defaults.rate};rate.setPointerCapture(event.pointerId);rate.classList.add('is-dragging');});
  listen(rate,'pointermove',event=>{if(drag?.id===event.pointerId)setRate(drag.value+Math.round((event.clientX-drag.x)/8));});
  function endDrag(event){if(!drag||event?.pointerId!==undefined&&event.pointerId!==drag.id)return;const id=drag.id;drag=null;rate.classList.remove('is-dragging');if(rate.hasPointerCapture?.(id))rate.releasePointerCapture(id);}
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(rate,type,endDrag);
  listen(win,'blur',endDrag);listen(doc,'visibilitychange',()=>{if(doc.hidden){hostClearTimeout(timer);timer=null;endDrag();}else{render();}});
  const unwatch=project.onDidChange(refreshFiles),unsubscribe=source.subscribe(render);
  const resize=typeof win.ResizeObserver==='function'?new win.ResizeObserver(draw):null;resize?.observe(canvas);
  refreshFiles();draw();
  return{refresh:render,refreshFiles,loadSelected,cancelPlay,
    dispose(){if(disposed)return;disposed=true;playSerial++;playPending=false;loading?.controller.abort();loading=null;hostClearTimeout(timer);resize?.disconnect();unwatch();unsubscribe();for(const remove of listeners)remove();},
  };
}
