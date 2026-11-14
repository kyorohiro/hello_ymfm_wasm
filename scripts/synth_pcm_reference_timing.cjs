// Test-only Playwright callback. The native renderer and the consumed-frame
// UI are updated by the same main-thread pump. Read them in one browser task;
// separate Playwright evaluations can observe two different pump generations.
function samplePcmReferenceTiming() {
  const reference=window.__pcmManualReference.current();
  const player=document.getElementById('synthSongPlayer');
  const consumedFrames=Number(player?.dataset.consumedFrames);
  if(!reference||!Number.isSafeInteger(reference.frames)||reference.frames<0||
    !Number.isSafeInteger(consumedFrames)||consumedFrames<0)throw Error('PCM reference timing observation is incomplete');
  return{reference,consumedFrames,playback:player.dataset.state};
}
module.exports={samplePcmReferenceTiming};

// Pure helpers are serialized into the browser too: Node regressions exercise
// the same native-copy, schedule and calibrated-gain checks as the real audit.
function createPcmReferenceTools() {
  const require=(condition,message)=>{if(!condition)throw Error(message);};
  function stereo(left,right) {
    const channel=values=>{let sum=0,squares=0,peak=0;for(const value of values){require(Number.isFinite(value),'Non-finite PCM');sum+=value;squares+=value*value;peak=Math.max(peak,Math.abs(value));}const mean=sum/values.length;return{frames:values.length,mean,peak,acRms:Math.sqrt(Math.max(0,squares/values.length-mean*mean))};};
    require(left.length>0&&left.length===right.length,'Incomplete stereo PCM window');
    const l=channel(left),r=channel(right);return{frames:left.length,finite:true,left:l,right:r,peak:Math.max(l.peak,r.peak),acRms:Math.sqrt((l.acRms*l.acRms+r.acRms*r.acRms)/2)};
  }
  function verifyNativePcm(left,right,firstFrame,native,sampleRate) {
    require(Number.isFinite(native.sampleRate)&&native.sampleRate>0&&sampleRate===native.sampleRate,'Scheduled PCM rate differs from the actual native engine rate');
    require(left.length===right.length&&Number.isSafeInteger(firstFrame),'Invalid scheduled PCM');
    const offset=firstFrame-native.firstFrame;
    require(offset>=0&&offset+left.length<=native.left.length&&native.left.length===native.right.length,'Native PCM history does not contain the scheduled source frames');
    for(let frame=0;frame<left.length;frame++)require(left[frame]===native.left[offset+frame]&&right[frame]===native.right[offset+frame],`Scheduled PCM differs from native render at source frame ${firstFrame+frame}`);
    return{firstFrame,endFrame:firstFrame+left.length,verifiedSamples:left.length*2};
  }
  function scheduleSummary(records) {
    let frames=0,verifiedSamples=0;const gaps=[];
    for(let index=0;index<records.length;index++) {
      const item=records[index];require(item.when>=item.contextTime,'Scheduled PCM starts in the past');
      require(item.sourceFirstFrame===frames,'Scheduled source PCM is missing or repeated');
      require(item.offset===0,'Calibration expects the untouched source prefix');
      if(index){const prior=records[index-1],end=prior.when+(prior.frames-prior.offset*prior.sampleRate)/prior.sampleRate,gap=item.when-end;require(gap>=-1e-9,'Scheduled PCM buffers overlap');if(gap>1e-9)gaps.push({start:end,end:item.when,seconds:gap});}
      frames+=item.frames;verifiedSamples+=item.verifiedSamples;
    }
    return{buffers:records.length,frames,verifiedSamples,gaps,gapSeconds:gaps.reduce((sum,item)=>sum+item.seconds,0),pastWhenCount:0,overlapCount:0};
  }
  function outputMeters(source,meters,connections) {
    require(source,'No verified reference source is scheduled');
    const seen=new Set(),pending=[source];while(pending.length){const node=pending.pop();if(seen.has(node))continue;seen.add(node);for(const next of connections.get(node)??[])pending.push(next);}
    return meters.filter(meter=>seen.has(meter.source)&&meter.active!==false&&connections.get(meter.source)?.has(meter.destination));
  }
  function referenceOutput(records,meters,connections) {
    for(let index=records.length-1;index>=0;index--){const record=records[index],reachable=outputMeters(record.source,meters,connections);if(reachable.length)return{meters:reachable,sourceFirstFrame:record.sourceFirstFrame};}
    throw Error('No live verified reference source reaches an output');
  }
  const pilotConfig={period:2**24,base:2**22};
  function verifyCaptureRouting(routes) {
    require(routes.length===2&&routes.some(route=>route.kind==='instrument'&&route.input===0)&&routes.some(route=>route.kind==='pilot'&&route.input===1),'Pilot must reach only capture input1, separate from instrument input0');
    return{instrumentInput:0,pilotInput:1,zeroOutput:true};
  }
  function verifyCaptureClock(capture) {
    let frames=0,priorOrdinal=null;const rawClockDifferences=[];
    for(const quantum of capture.quanta){require(Number.isSafeInteger(quantum.ordinal)&&(priorOrdinal===null||quantum.ordinal===priorOrdinal+1)&&quantum.frames>0&&quantum.pilotInputFrames===quantum.frames,'Captured callback/pilot input sequence is incomplete');
      const expectedRaw=capture.quanta[0].firstFrame+frames;if(quantum.firstFrame!==expectedRaw)rawClockDifferences.push({ordinal:quantum.ordinal,actual:quantum.firstFrame,expected:expectedRaw});frames+=quantum.frames;priorOrdinal=quantum.ordinal;}
    require(frames===capture.left.length&&capture.right.length===frames&&capture.pilot.length===frames,'Captured PCM interval does not match its exact sample window');
    require(capture.pilotPeriod===pilotConfig.period&&capture.pilotBase===pilotConfig.base&&Number.isSafeInteger(capture.pilotStartFrame)&&capture.pilotStartFrame>=0,'Invalid sample-aligned pilot start');
    const firstCounter=capture.pilot[0]*pilotConfig.period-pilotConfig.base;
    require(Number.isSafeInteger(firstCounter)&&firstCounter>=0&&firstCounter+frames<=capture.pilotLength,'Pilot window lies outside its known scheduled source');
    for(let i=0;i<frames;i++)require(capture.pilot[i]*pilotConfig.period===pilotConfig.base+firstCounter+i,'Independent pilot PCM is missing or repeated at captured sample '+i);
    const firstFrame=capture.pilotStartFrame+firstCounter,endFrame=firstFrame+frames;
    require(capture.firstFrame===firstFrame&&capture.endFrame===endFrame,'Captured absolute frame window differs from the independent pilot');
    return{firstFrame,endFrame,frames,quanta:capture.quanta.length,pilotContinuous:true,pilotStartFrame:capture.pilotStartFrame,pilotFirstCounter:firstCounter,rawClockContinuous:rawClockDifferences.length===0,rawClockDifferences,observedClockAnomalies:capture.clockAnomalies};
  }
  function calibratedPair(initial,half) {
    const gain=value=>{require(value.actual.finite&&value.expected.finite&&value.expected.acRms>1e-7,'Calibration window has no finite native signal');return value.actual.acRms/value.expected.acRms;};
    const initialGain=gain(initial);require(Math.abs(initialGain-1)<.15,'Calibrated native/output RMS differs by 15% or more');
    require(initial.actual.peak<=initial.expected.peak*1.15+.0001,'Output peak exceeds the calibrated native window');
    if(!half)return{initialGain};
    const halfGain=gain(half);require(Math.abs(halfGain/initialGain-.5)<.07,'Master half-volume gain differs from 0.5 by 0.07 or more');
    return{initialGain,halfGain,masterGainRatio:halfGain/initialGain};
  }
  return{stereo,verifyNativePcm,scheduleSummary,outputMeters,referenceOutput,pilotConfig,verifyCaptureRouting,verifyCaptureClock,calibratedPair};
}

// A passive tap reports the exact device-frame interval. It posts only on
// request, never schedules a source and emits zeros into the existing mute.
function pcmCaptureWorkletSource() {
  return `class PcmCheckCapture extends AudioWorkletProcessor {
    constructor(options){super();const config=options.processorOptions;this.period=config.period;this.base=config.base;this.left=new Float32Array(8192);this.right=new Float32Array(8192);this.pilot=new Float32Array(8192);this.cursor=0;this.count=0;this.request=null;this.quanta=[];this.quantumFrames=0;this.clockAnomalies=[];this.lastEndFrame=null;this.ordinal=0;this.pilotStartFrame=null;this.pilotLength=0;this.port.onmessage=event=>{if(event.data.type==='pilot'){this.pilotStartFrame=event.data.firstFrame;this.pilotLength=event.data.frames;}else this.request=event.data;};}
    process(inputs,outputs){const input=inputs[0],left=input?.[0],right=input?.[1]??left,pilot=inputs[1]?.[0],frames=outputs[0][0].length;
      for(const output of outputs[0])output.fill(0);
      for(let i=0;i<frames;i++){this.left[this.cursor]=left?.[i]??0;this.right[this.cursor]=right?.[i]??0;this.pilot[this.cursor]=pilot?.[i]??NaN;this.cursor=(this.cursor+1)%8192;}
      this.count=Math.min(8192,this.count+frames);const rawFrame=currentFrame,rawEndFrame=rawFrame+frames;
      if(this.lastEndFrame!==null&&rawFrame!==this.lastEndFrame)this.clockAnomalies.push({expected:this.lastEndFrame,actual:rawFrame});this.lastEndFrame=rawEndFrame;
      this.quanta.push({firstFrame:rawFrame,frames,ordinal:this.ordinal++,pilotInputFrames:pilot?.length??0});this.quantumFrames+=frames;while(this.quantumFrames-this.quanta[0].frames>=8192)this.quantumFrames-=this.quanta.shift().frames;
      const lastCounter=pilot?.[frames-1]*this.period-this.base,endFrame=this.pilotStartFrame+lastCounter+1;
      if(this.request&&this.pilotStartFrame!==null&&this.count===8192&&lastCounter>=8191&&endFrame-8192>=this.request.afterFrame){const l=new Float32Array(8192),r=new Float32Array(8192),p=new Float32Array(8192);for(let i=0;i<8192;i++){l[i]=this.left[(this.cursor+i)%8192];r[i]=this.right[(this.cursor+i)%8192];p[i]=this.pilot[(this.cursor+i)%8192];}this.port.postMessage({token:this.request.token,firstFrame:endFrame-8192,endFrame,left:l,right:r,pilot:p,pilotStartFrame:this.pilotStartFrame,pilotLength:this.pilotLength,pilotPeriod:this.period,pilotBase:this.base,quanta:this.quanta.slice(),clockAnomalies:this.clockAnomalies.slice()},[l.buffer,r.buffer,p.buffer]);this.request=null;}
      return true;
    }
  } registerProcessor('pcm-check-capture',PcmCheckCapture);`;
}

async function renderPcmScheduledWindow(records,capture,OfflineContext,primitives) {
  const rate=capture.sampleRate,firstTime=capture.firstFrame/rate,endTime=capture.endFrame/rate;
  const offline=new OfflineContext(2,capture.endFrame-capture.firstFrame,rate);
  for(const record of records){const end=record.when+record.frames/record.sampleRate-record.offset;if(end<=firstTime||record.when>=endTime)continue;
    const node=offline.createBufferSource();node.buffer=record.buffer;
    (primitives?.connect??node.connect).call(node,offline.destination);
    (primitives?.start??node.start).call(node,Math.max(0,record.when-firstTime),record.offset+Math.max(0,firstTime-record.when));
  }
  return offline.startRendering();
}

function installPcmWindowAudit(tools,workletSource,renderExpected) {
  const output=window.__pcmManualOutput,start=AudioBufferSourceNode.prototype.start,records=[],chains=new Map();
  let enabled=true,tap=null,token=0,pending=null;
  AudioBufferSourceNode.prototype.start=function(when=0,offset=0,...args){
    const contextTime=this.context.currentTime,result=start.call(this,when,offset,...args);
    if(enabled&&window.__pcmManualReference&&typeof this.context.startRendering!=='function'){
      const native=window.__pcmManualReference.nativePcm(),key=native.id+':'+native.resets;
      let chain=chains.get(key);if(!chain){chain={next:0};chains.set(key,chain);}
      const verified=tools.verifyNativePcm(this.buffer.getChannelData(0),this.buffer.getChannelData(1),chain.next,native,this.buffer.sampleRate);
      records.push({source:this,buffer:this.buffer,when,offset,contextTime,frames:this.buffer.length,sampleRate:this.buffer.sampleRate,sourceFirstFrame:verified.firstFrame,verifiedSamples:verified.verifiedSamples});chain.next=verified.endFrame;
    }
    return result;
  };
  async function prepare(){
    const selected=tools.referenceOutput(records,output.meterNodes(),output.connections()),meters=selected.meters;if(meters.length!==1)throw Error('Calibration expects one actual stereo output');
    const meter=meters[0],context=meter.source.context,url=URL.createObjectURL(new Blob([workletSource],{type:'application/javascript'}));
    try{await context.audioWorklet.addModule(url);}finally{URL.revokeObjectURL(url);}
    const node=new AudioWorkletNode(context,'pcm-check-capture',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2],channelCount:2,channelCountMode:'max',processorOptions:tools.pilotConfig});
    const primitives=output.primitives(),connect=primitives.connect,routes=[];
    connect.call(meter.source,node,0,0);routes.push({kind:'instrument',input:0});connect.call(node,meter.mute);
    const pilotBuffer=context.createBuffer(1,Math.ceil(context.sampleRate*30),context.sampleRate),values=pilotBuffer.getChannelData(0);
    for(let i=0;i<values.length;i++)values[i]=(tools.pilotConfig.base+i)/tools.pilotConfig.period;
    const pilot=context.createBufferSource();pilot.buffer=pilotBuffer;connect.call(pilot,node,0,1);routes.push({kind:'pilot',input:1});
    const routing=tools.verifyCaptureRouting(routes),pilotStartFrame=Math.ceil((context.currentTime+.25)*context.sampleRate);
    node.port.postMessage({type:'pilot',firstFrame:pilotStartFrame,frames:values.length});
    const pilotWhen=pilotStartFrame/context.sampleRate,pilotObservedTime=context.currentTime;
    if(pilotWhen<pilotObservedTime||Math.round(pilotWhen*context.sampleRate)!==pilotStartFrame)throw Error('Pilot must start on a future sample-aligned device frame');
    primitives.start.call(pilot,pilotWhen);
    node.port.onmessage=event=>{if(pending&&event.data.token===pending.token){const done=pending;pending=null;done.resolve(event.data);}};
    tap={node,context,source:meter.source,sourceFirstFrame:selected.sourceFirstFrame,pilot,pilotStartFrame,pilotWhen,pilotObservedTime,routing};
  }
  async function capture(afterTime){
    if(!tap||pending)throw Error('PCM capture is not ready');
    const afterFrame=Math.ceil(afterTime*tap.context.sampleRate),requestToken=++token;
    let timer;const actualPcm=await new Promise((resolve,reject)=>{timer=setTimeout(()=>{pending=null;reject(Error('Timed out waiting for a complete audio-frame capture window'));},20000);pending={token:requestToken,resolve,reject};tap.node.port.postMessage({token:requestToken,afterFrame});}).finally(()=>clearTimeout(timer));
    if(actualPcm.firstFrame<afterFrame)throw Error('PCM capture includes samples before the Master change');
    const clock=tools.verifyCaptureClock(actualPcm);
    const rate=tap.context.sampleRate,firstTime=actualPcm.firstFrame/rate,endTime=actualPcm.endFrame/rate;
    const expectedBuffer=await renderExpected(records,{sampleRate:rate,firstFrame:actualPcm.firstFrame,endFrame:actualPcm.endFrame},OfflineAudioContext,output.primitives()),actual=tools.stereo(actualPcm.left,actualPcm.right),expected=tools.stereo(expectedBuffer.getChannelData(0),expectedBuffer.getChannelData(1));
    const schedule=tools.scheduleSummary(records),windowGaps=schedule.gaps.map(gap=>({start:Math.max(firstTime,gap.start),end:Math.min(endTime,gap.end)})).filter(gap=>gap.end>gap.start);
    return{sampleRate:rate,firstFrame:actualPcm.firstFrame,endFrame:actualPcm.endFrame,afterFrame,clock,pilotStart:{frame:tap.pilotStartFrame,when:tap.pilotWhen,observedTime:tap.pilotObservedTime,sampleRate:rate},routing:tap.routing,meterSourceFirstFrame:tap.sourceFirstFrame,actual,expected,schedule:{...schedule,windowGaps,windowGapSeconds:windowGaps.reduce((sum,gap)=>sum+gap.end-gap.start,0)},contextTime:tap.context.currentTime};
  }
  function finish(){enabled=false;records.length=0;chains.clear();if(tap){const disconnect=output.primitives().disconnect??AudioNode.prototype.disconnect;disconnect.call(tap.source,tap.node);tap.pilot.stop();disconnect.call(tap.pilot);disconnect.call(tap.node);tap.node.port.close();tap=null;}}
  window.__pcmWindowAudit={prepare,capture,finish,time:()=>Math.max(tap.context.currentTime,tap.pilotStartFrame/tap.context.sampleRate)};
}
module.exports.createPcmReferenceTools=createPcmReferenceTools;
module.exports.pcmCaptureWorkletSource=pcmCaptureWorkletSource;
module.exports.installPcmWindowAudit=installPcmWindowAudit;

module.exports.renderPcmScheduledWindow=renderPcmScheduledWindow;
