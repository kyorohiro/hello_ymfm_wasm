const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const results=[];
 for(let round=0;round<(Number(process.argv[3])||1);round++)for(const [name,browserType] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await browserType.launch({headless:true,args:name==='chromium'?['--autoplay-policy=no-user-gesture-required']:[]});
  try{
   const page=await browser.newPage();
   // A plain page avoids mixing the test signal with Playground's own context.
   await page.goto(process.argv[2]||'http://127.0.0.1:8093/playground/index.html');
   await page.evaluate(()=>{
    const button=document.createElement('button');button.id='master-volume-test';button.textContent='Test volume';
    button.style.cssText='position:fixed;top:8px;right:8px;z-index:2147483647;';
    button.onclick=()=>{window.__masterVolumeCapture=(async()=>{
    const context=new AudioContext({sampleRate:48000});await context.resume();
    const {TetoricaAudioRuntime}=await import('/js/tetorica_audio_runtime.js');
    const runtime=new TetoricaAudioRuntime({audioContext:context});runtime.ensureRouting(context);
    const module=URL.createObjectURL(new Blob([`
     class Capture extends AudioWorkletProcessor{
      constructor(){super();this.data=new Float32Array(sampleRate);this.frames=0;}
      process(inputs,outputs){
       const input=inputs[0]?.[0];if(!input)return true;
       if(this.frames===0)this.startFrame=currentFrame;
       const count=Math.min(input.length,this.data.length-this.frames);this.data.set(input.subarray(0,count),this.frames);this.frames+=count;
       if(this.frames===this.data.length){this.port.postMessage({pcm:this.data,startFrame:this.startFrame},[this.data.buffer]);return false;}
       return true;
      }
     }registerProcessor('capture-master-volume',Capture);
    `],{type:'text/javascript'}));
    await context.audioWorklet.addModule(module);URL.revokeObjectURL(module);
    const recorder=new AudioWorkletNode(context,'capture-master-volume');
    const captured=new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>reject(new Error('Master-volume capture timed out')),5000);
     recorder.port.onmessage=({data})=>{clearTimeout(timer);resolve(data);};
    });
    runtime.connectOutputMonitor(recorder);recorder.connect(context.destination);
    const source=new ConstantSourceNode(context,{offset:.4});source.connect(runtime.masterInputNode);source.start();
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const commands=[];
    const volume=value=>{runtime.setMasterVolume(value);commands.push({at:context.currentTime,value,target:runtime.masterVolume});};
    await wait(60);volume(0);await wait(60);volume(1);await wait(60);volume(.2);
    await wait(2);volume(.8);await wait(2);volume(.4);
    await wait(15);await context.suspend();volume(.3);const resumedAt=context.currentTime;await context.resume();
    await wait(10);volume(.6);await wait(2);volume(.4);
    const {pcm,startFrame}=await captured;source.stop();await context.close();
    const resumeFrame=Math.round(resumedAt*context.sampleRate)-startFrame;
    let maxStep=0,maxStepFrame=0,min=Infinity,max=-Infinity,transitions=0,pausedEdges=0,pausedEdgeFrame=0;
    // Ignore the ConstantSource's initial start edge.
    for(let i=2048;i<pcm.length;i++){
     min=Math.min(min,pcm[i]);max=Math.max(max,pcm[i]);
     // Changing gain while suspended is immediate by design. Its resumed
     // initialization is checked separately from continuously playing audio.
     if(pausedEdges===0&&Math.abs(pcm[i-1]-.16)<.00001&&Math.abs(pcm[i]-.12)<.00001){pausedEdges++;pausedEdgeFrame=i;continue;}
     const step=Math.abs(pcm[i]-pcm[i-1]);if(step>maxStep){maxStep=step;maxStepFrame=i;}
     if(step>.00001)transitions++;
    }
    return {rate:context.sampleRate,hasCancelAndHold:typeof runtime.masterOutputNode.gain.cancelAndHoldAtTime==='function',resumeFrame,pausedEdges,pausedEdgeFrame,resumedGain:pcm[pausedEdgeFrame+1]/.4,maxStep,maxStepFrame,min,max,transitions,commands,edge:Array.from(pcm.subarray(maxStepFrame-3,maxStepFrame+4))};
    })();};document.body.append(button);
   });
   await page.click('#master-volume-test');
   const measured=await page.evaluate(()=>Promise.race([window.__masterVolumeCapture,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Audio activation timed out')),8000))]));
   assert(measured.transitions>400,`${name}: gain transitions were not captured`);
   assert(measured.maxStep<=.4*(1-Math.exp(-1/(measured.rate*.001)))+.0005,`${name}: discontinuous master gain ${JSON.stringify(measured)}`);
   assert(measured.min<.001&&measured.max>.39,`${name}: mute/unmute did not reach targets`);
   assert(Math.abs(measured.resumedGain-.3)<.0001,`${name}: suspended gain change was not applied on resume`);
   assert.equal(measured.pausedEdges,1,`${name}: expected paused initialization edge was not captured`);
   console.log(JSON.stringify({round,browser:name,passed:true,maxStep:measured.maxStep,transitions:measured.transitions}));
   results.push({round,browser:name,...measured});
  }finally{await browser.close();}
 }
 console.log(JSON.stringify({passed:true,results}));
})().catch(error=>{console.error(error);process.exit(1);});
