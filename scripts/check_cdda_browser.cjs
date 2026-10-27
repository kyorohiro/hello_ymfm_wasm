// Real CD-DA WASM/AudioWorklet integration. Capture precedes a zeroed physical
// output; the generated PCM16 stereo fixture contains no third-party material.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const args=process.argv.slice(2),root=path.resolve(__dirname,'..');
const selected=args.includes('--chromium')?['chromium']:args.includes('--webkit')?['webkit']:['chromium','webkit'];
const out=args.find(arg=>arg.startsWith('--out='))?.slice(6),served=new Map();
if(args.some(arg=>!['--chromium','--webkit'].includes(arg)&&!arg.startsWith('--out=')))throw Error('Usage: node scripts/check_cdda_browser.cjs [--chromium|--webkit] [--out=REPORT.json]');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const captureSource=`class Capture extends AudioWorkletProcessor{
  constructor(){super();this.pending=null;this.port.onmessage=({data})=>{if(this.pending)throw Error('Capture already active');this.pending={id:data.id,left:new Float32Array(data.frames),right:new Float32Array(data.frames),offset:0,start:null};};}
  process(inputs,outputs){for(const channel of outputs[0])channel.fill(0);const p=this.pending;if(!p)return true;const input=inputs[0];if(p.start===null){p.start=currentFrame;this.port.postMessage({id:p.id,type:'started',firstFrame:p.start});}
    const count=Math.min(128,p.left.length-p.offset);for(let i=0;i<count;i++){p.left[p.offset+i]=input[0]?.[i]??0;p.right[p.offset+i]=input[1]?.[i]??0;}p.offset+=count;
    if(p.offset===p.left.length){this.pending=null;this.port.postMessage({id:p.id,type:'done',firstFrame:p.start,left:p.left,right:p.right},[p.left.buffer,p.right.buffer]);}return true;
  }
}registerProcessor('cdda-test-capture',Capture);`;
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end('<button id="run">Check CD-DA</button>');return;}
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    if(pathname==='/__cdda_capture.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(captureSource);return;}
    const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error('Invalid path');
    let bytes=await fs.readFile(file);const name=path.relative(root,file),hash=sha(bytes);
    if(served.has(name)&&served.get(name).sha256!==hash)throw Error('Source changed during Browser check: '+name);
    served.set(name,{bytes:bytes.length,sha256:hash});
    if(pathname==='/docs/playground/playground.js')bytes=Buffer.from(bytes.toString()+'\nwindow.__cddaPlayground={runtime,megaDrive,virtualFiles,setSource:value=>editorAdapter.setValue(value)};');
    const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch(error){res.writeHead(404).end(error.message);}
});

async function browserCheck(page,rate){
  await page.evaluate(rate=>{
    document.getElementById('run').onclick=()=>{window.result=(async()=>{
      const context=new AudioContext({sampleRate:rate});await context.resume();
      const check=(ok,message)=>{if(!ok)throw Error(message);};
      const near=(actual,expected,label,tolerance=1e-6)=>check(Math.abs(actual-expected)<=tolerance,`${label}: ${actual} != ${expected}`);
      const {createCddaAudio}=await import('/web/cdda_audio.js');
      const {createCddaPlayer}=await import('/web/cdda_player.js');
      check(context.sampleRate===rate,'Requested output rate must be used');
      await context.audioWorklet.addModule('/__cdda_capture.js');
      const capture=new AudioWorkletNode(context,'cdda-test-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      capture.connect(context.destination);let id=0,waiters=new Map();
      capture.port.onmessage=({data})=>{const current=waiters.get(data.id);if(!current)return;if(data.type==='started')current.started(data);else{waiters.delete(data.id);clearTimeout(current.timer);current.done(data);}};
      function beginCapture(frames){
        let start,done,reject;const started=new Promise(resolve=>start=resolve),result=new Promise((resolve,fail)=>{done=resolve;reject=fail;});
        const token=++id,timer=setTimeout(()=>{waiters.delete(token);reject(Error('Audio clock capture timed out'));},10000);
        waiters.set(token,{started:start,done,timer});capture.port.postMessage({id:token,frames});return {started,result};
      }
      async function take(frames=Math.round(rate*.035)){const current=beginCapture(frames);return current.result;}
      const frames=44100,bytes=new Uint8Array(44+frames*4),view=new DataView(bytes.buffer),encoder=new TextEncoder();
      bytes.set(encoder.encode('RIFF'));bytes.set(encoder.encode('WAVEfmt '),8);view.setUint32(4,bytes.length-8,true);view.setUint32(16,16,true);
      view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,44100,true);view.setUint32(28,176400,true);view.setUint16(32,4,true);view.setUint16(34,16,true);
      bytes.set(encoder.encode('data'),36);view.setUint32(40,frames*4,true);
      for(let n=0;n<frames;n++){view.setInt16(44+n*4,Math.round(10000*Math.sin(2*Math.PI*n/100)),true);view.setInt16(46+n*4,Math.round(6000*Math.cos(2*Math.PI*n/50)),true);}
      function expected(frame,channel){if(frame<0||frame>=frames)return 0;const a=Math.floor(frame),fraction=frame-a;
        const left=view.getInt16(44+a*4+channel*2,true)/32768;
        const right=a+1<frames?view.getInt16(44+(a+1)*4+channel*2,true)/32768:left;
        return left+(right-left)*fraction;
      }
      function analyze(data,{origin,sourceFrame=0,phase=0,gain=1,pan=0,zero=false,label}){
        let peak=0,difference=0,error=0,active=0;
        for(let n=0;n<data.left.length;n++){
          const time=data.firstFrame+n-origin,position=sourceFrame+phase/rate+time*44100/rate;
          for(let channel=0;channel<2;channel++){
            const actual=channel?data.right[n]:data.left[n];check(Number.isFinite(actual),`${label}: finite PCM`);peak=Math.max(peak,Math.abs(actual));
            const level=gain*(channel?1+Math.min(0,pan):1-Math.max(0,pan));
            const target=zero||time<0?0:expected(position,channel)*level;error=Math.max(error,Math.abs(actual-target));if(Math.abs(actual)>1e-4)active++;
          }
          difference=Math.max(difference,Math.abs(data.left[n]-data.right[n]));
        }
        check(peak<1,`${label}: unclipped`);check(error<2e-6,`${label}: sample-accurate raw PCM / interpolation max error ${error}`);
        if(zero)check(peak===0,`${label}: exact silence`);
        return {firstFrame:data.firstFrame,frames:data.left.length,peak,stereoDifference:difference,maxError:error,activeSamples:active};
      }
      let audio,player;const results={};
      try{
        audio=await createCddaAudio(context);audio.node.connect(capture);
        player=createCddaPlayer(audio,{readFile:async path=>{check(path==='/disc/track.wav','Virtual Files path');return bytes;}});
        await player.load({tracks:[{number:2,file:'/disc/track.wav',title:'Generated stereo fixture'}]});
        check(player.list()[0].number===2,'Manifest track number preserved');
        // The capture begins before a scheduled play command. Its exact audio
        // frame supplies the oracle, rather than a UI timer or analyser window.
        let recording=beginCapture(Math.round(rate*.18)),start=await recording.started;
        const playFrame=start.firstFrame+Math.round(rate*.05);
        const playing=await player.play(2,{at:playFrame/rate});
        check(playing.scheduled&&playing.scheduledFrame===playFrame,'Play admitted for exact scheduled output frame');
        const initial=await recording.result;
        results.scheduled=analyze(initial,{origin:playFrame,label:'scheduled stereo'});
        check(results.scheduled.activeSamples>1000&&results.scheduled.stereoDifference>.1,'Independent stereo channels are audible');
        check(initial.firstFrame<playFrame,'Capture includes pre-play silence');
        for(let n=0;n<playFrame-initial.firstFrame;n++)check(initial.left[n]===0&&initial.right[n]===0,'Scheduled leading silence');
        const paused=await player.pause();
        results.paused=analyze(await take(),{origin:0,zero:true,label:'pause'});
        const stable=await player.getState();check(stable.positionFrames===paused.positionFrames&&stable.phase===paused.phase,'Pause preserves exact rational cursor');
        const resumed=await player.resume();
        results.resumed=analyze(await take(),{origin:resumed.outputFrame,sourceFrame:resumed.positionFrames,phase:resumed.phase,label:'resume'});
        check(results.resumed.activeSamples>100,'Resume produces PCM');
        await player.pause();const seekFrame=1234;
        await player.seek(seekFrame/44100);const sought=await player.getState();check(sought.positionFrames===seekFrame&&sought.phase===0,'Paused seek sets exact source frame');
        results.seekPaused=analyze(await take(),{origin:0,zero:true,label:'paused seek'});
        const origin=await player.resume();
        results.seekResume=analyze(await take(),{origin:origin.outputFrame,sourceFrame:seekFrame,label:'seek/resume'});
        const beforeMute=await player.getState();await audio.command({type:'mix',mute:true});
        results.muted=analyze(await take(),{origin:0,zero:true,label:'mute'});
        const afterMute=await player.getState();check(afterMute.positionFrames>beforeMute.positionFrames,'Muted PCM continues advancing its source cursor');
        await audio.command({type:'mix',mute:false,volume:.5,pan:-1});
        results.panLeft=analyze(await take(),{origin:origin.outputFrame,sourceFrame:seekFrame,gain:.5,pan:-1,label:'half volume / left pan'});
        await audio.command({type:'mix',pan:1});
        results.panRight=analyze(await take(),{origin:origin.outputFrame,sourceFrame:seekFrame,gain:.5,pan:1,label:'right pan'});
        await audio.command({type:'mix',volume:1,pan:0});
        const future=await audio.command({type:'play',sourceFrame:0},{at:context.currentTime+.08});
        await player.stop();
        check(future.scheduled,'Future playback was admitted before Stop');results.futureCancelled={scheduledFrame:future.scheduledFrame,stopClearsFuture:true};
        results.stopped=analyze(await take(Math.round(rate*.12)),{origin:0,zero:true,label:'stop and future cancellation'});
        const stopped=await player.getState();check(stopped.positionFrames===0&&stopped.state==='ready','Stop rewinds and leaves selected track ready');
        recording=beginCapture(Math.round(rate*.17));start=await recording.started;
        const staleFrame=start.firstFrame+Math.round(rate*.12),scheduledStop=start.firstFrame+Math.round(rate*.04),freshFrame=start.firstFrame+Math.round(rate*.08);
        await audio.command({type:'play',sourceFrame:500},{at:staleFrame/rate});
        await player.stop({at:scheduledStop/rate});
        await player.play(2,{offset:1234/44100,at:freshFrame/rate});
        results.scheduledStop=analyze(await recording.result,{origin:freshFrame,sourceFrame:1234,label:'scheduled Stop cancels older future actions and retains later admissions'});
        await player.stop();
        recording=beginCapture(Math.round(rate*.065));start=await recording.started;
        const endPlayFrame=start.firstFrame+Math.round(rate*.02),endSource=frames-300;
        await player.play(2,{offset:endSource/44100,at:endPlayFrame/rate});
        results.ended=analyze(await recording.result,{origin:endPlayFrame,sourceFrame:endSource,label:'natural track end'});
        const ended=await player.getState();check(ended.state==='ended'&&ended.positionFrames===frames,'Natural end pins cursor to duration');
        const replay=await player.play();
        results.replayed=analyze(await take(),{origin:replay.outputFrame,label:'replay after end'});
        check(results.replayed.activeSamples>100,'Replay after end produces PCM');
        player.dispose();player=null;
        results.disposed=analyze(await take(),{origin:0,zero:true,label:'disposed endpoint'});
        check(context.state!=='closed','Player does not close borrowed context');
        return {sampleRate:context.sampleRate,sourceRate:44100,sourceFrames:frames,physicalOutputMuted:true,results};
      }finally{player?.dispose();audio?.dispose();capture.disconnect();capture.port.close();await context.close();}
    })();};
  },rate);
  await page.click('#run');return page.evaluate(()=>window.result);
}

async function playgroundCheck(page,origin,execution){
  // Mute the physical destination independently of the graph being measured.
  await page.addInitScript(()=>{
    const connect=AudioNode.prototype.connect,gates=new WeakMap();
    AudioNode.prototype.connect=function(destination,...rest){
      if(destination===this.context.destination){let gate=gates.get(this.context);if(!gate){gate=this.context.createGain();gate.gain.value=0;gates.set(this.context,gate);connect.call(gate,destination);}return connect.call(this,gate,...rest);}
      return connect.call(this,destination,...rest);
    };
  });
  await page.goto(`${origin}/docs/playground/index.html?mode=pc-engine&no-sw=1`);
  await page.waitForFunction(()=>window.__cddaPlayground&&window.monaco?.editor?.getEditors().length);
  await page.locator('#startupNotice').waitFor({state:'hidden'});
  await page.evaluate(execution=>{
    const shared=window.__cddaPlayground,frames=44100*4,bytes=new Uint8Array(44+frames*4),view=new DataView(bytes.buffer),encode=new TextEncoder();
    bytes.set(encode.encode('RIFF'));bytes.set(encode.encode('WAVEfmt '),8);view.setUint32(4,bytes.length-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,44100,true);view.setUint32(28,176400,true);view.setUint16(32,4,true);view.setUint16(34,16,true);bytes.set(encode.encode('data'),36);view.setUint32(40,frames*4,true);
    for(let n=0;n<frames;n++){view.setInt16(44+n*4,Math.round(10000*Math.sin(2*Math.PI*n/100)),true);view.setInt16(46+n*4,Math.round(6000*Math.cos(2*Math.PI*n/50)),true);}
    shared.virtualFiles.writeBinary('/cdda/browser-test.wav',bytes);
    shared.virtualFiles.writeText('/cdda/browser-test.json',JSON.stringify({tracks:[{number:2,file:'/cdda/browser-test.wav',title:'Generated Browser fixture'}]}));
    shared.setSource(`await cdda.load('/cdda/browser-test.json');
const tracks = await cdda.list();
if (tracks.length !== 1 || tracks[0].number !== 2) throw Error('CDDA manifest metadata');
await cdda.play(2);
const format = await cdda.getState();
if (format.sourceRate !== 44100 || !Number.isInteger(format.sampleRate) || format.sampleRate < 8000) throw Error('CDDA source/output rates');
if (Math.abs(format.positionSeconds - (format.positionFrames + format.phase / format.sampleRate) / 44100) > 1e-12) throw Error('CDDA fractional position seconds');
console.log('__CDDA_FORMAT__', JSON.stringify({sourceRate: format.sourceRate, sampleRate: format.sampleRate}));
console.log('__CDDA_STAGE__base'); await sleep(0.45);
await mixer.set('cdda', {volume: 0.5, pan: -1});
const panState = await cdda.getState();
if (panState.volume !== 0.5 || panState.pan !== -1 || panState.mute !== false) throw Error('CDDA observed Mixer pan/volume');
console.log('__CDDA_STAGE__pan'); await sleep(0.3);
await mixer.set('cdda', {muted: true});
if (!(await cdda.getState()).mute) throw Error('CDDA observed Mixer mute');
console.log('__CDDA_STAGE__mute'); await sleep(0.3);
await mixer.set('cdda', {volume: 1, pan: 0, muted: false});
const paused = await cdda.pause();
console.log('__CDDA_STAGE__pause'); await sleep(0.3);
const stable = await cdda.getState();
if (stable.positionFrames !== paused.positionFrames || stable.state !== 'paused') throw Error('CDDA paused cursor');
await cdda.seek(0.25); const sought = await cdda.getState();
if (sought.positionFrames !== 11025 || sought.track !== 2) throw Error('CDDA seek cursor');
await cdda.resume();
console.log('__CDDA_STAGE__resume'); await sleep(0.3);
console.log('__CDDA_DONE__');
liveLoop('cdda-browser-lifecycle', async () => { await sleep(0.1); });`);
    document.getElementById('workerExecution').checked=execution==='worker';
  },execution);
  await page.click('#runButton');
  await page.waitForFunction(()=>document.getElementById('consoleOutput')?.textContent.includes('__CDDA_STAGE__base'));
  await page.evaluate(async()=>{
    const shared=window.__cddaPlayground,context=shared.megaDrive.audioContext;
    await context.audioWorklet.addModule('/__cdda_capture.js');
    const node=new AudioWorkletNode(context,'cdda-test-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
    node.connect(context.destination);const detach=shared.megaDrive.audio.connectOutputMonitor(node);
    let current=null,id=0;node.port.onmessage=({data})=>{if(data.type==='done'&&current?.id===data.id){const value=current;current=null;clearTimeout(value.timer);value.resolve(data);}};
    shared.take=()=>new Promise((resolve,reject)=>{const token=++id,timer=setTimeout(()=>reject(Error('Playground audio capture timeout')),5000);current={id:token,resolve:data=>resolve({...data,left:data.left.subarray(1024),right:data.right.subarray(1024)}),timer};
      // The existing Mixer smooths controls over 5 ms. Discard 1,024 actual
      // output frames before testing its settled output, independent of UI time.
      node.port.postMessage({id:token,frames:3072});});
    shared.closeCapture=()=>{detach();node.disconnect();node.port.close();};
  });
  const results={};
  try{
    for(const phase of ['base','pan','mute','pause','resume']){
      await page.waitForFunction(phase=>document.getElementById('consoleOutput')?.textContent.includes('__CDDA_STAGE__'+phase),phase);
      results[phase]=await page.evaluate(async()=>{
        const data=await window.__cddaPlayground.take();let left=0,right=0,difference=0,finite=true;
        for(let n=0;n<data.left.length;n++){finite&&=Number.isFinite(data.left[n])&&Number.isFinite(data.right[n]);left=Math.max(left,Math.abs(data.left[n]));right=Math.max(right,Math.abs(data.right[n]));difference=Math.max(difference,Math.abs(data.left[n]-data.right[n]));}
        return {left,right,difference,finite};
      });
      const value=results[phase];assert(value.finite&&Math.max(value.left,value.right)<1,`${execution}/${phase}: finite unclipped host PCM`);
      if(['mute','pause'].includes(phase))assert(value.left===0&&value.right===0,`${execution}/${phase}: host exact silence`);
      else if(phase==='pan')assert(value.left>.01&&value.right===0,`${execution}: independent CD-DA strip pan`);
      else assert(value.left>.01&&value.right>.01&&value.difference>.02,`${execution}/${phase}: stereo CD-DA host PCM`);
    }
    await page.waitForFunction(()=>document.getElementById('consoleOutput')?.textContent.includes('__CDDA_DONE__'));
    const strips=await page.evaluate(()=>window.__cddaPlayground.megaDrive.mixer.list().map(strip=>({id:strip.id,kind:strip.kind})));
    assert.equal(strips.filter(strip=>strip.id==='cdda').length,1,'one independent CD-DA Mixer strip');
    await page.click('#stopButton');await page.waitForFunction(()=>window.__cddaPlayground.runtime.getState().playback==='stopped');
    const stop=await page.evaluate(async()=>{
      const data=await window.__cddaPlayground.take();return {peak:Math.max(...data.left.map(Math.abs),...data.right.map(Math.abs)),strips:window.__cddaPlayground.megaDrive.mixer.list().map(strip=>strip.id)};
    });
    assert.equal(stop.peak,0,'global Stop silences CD-DA');assert(!stop.strips.includes('cdda'),'global Stop retires CD-DA Mixer strip');
    const format=await page.evaluate(()=>{
      const text=document.getElementById('consoleOutput').textContent,match=text.match(/__CDDA_FORMAT__\s+(\{[^\n]+\})/);
      return {reported:match?JSON.parse(match[1]):null,actualSampleRate:window.__cddaPlayground.megaDrive.audioContext.sampleRate};
    });
    assert.equal(format.reported?.sourceRate,44100);assert.equal(format.reported?.sampleRate,format.actualSampleRate);
    return {execution,results,strips,stop,format,observedMixerState:true,virtualFiles:true,physicalOutputMuted:true};
  }finally{await page.evaluate(()=>window.__cddaPlayground.closeCapture?.());}
}

(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,results=[],playground=[];
  try{
    for(const name of selected){
      const type=name==='chromium'?chromium:webkit,browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try{
        for(const rate of [44100,48000]){
          const page=await browser.newPage(),errors=[],badResponses=[];page.setDefaultTimeout(30000);
          page.on('pageerror',error=>{errors.push(error.message);console.error(`${name}/${rate} pageerror: ${error.message}`);});
          page.on('console',message=>{if(message.type()==='error')console.error(`${name}/${rate} console: ${message.text()}`);});
          page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
          try{
            await page.goto(origin);const result=await browserCheck(page,rate);
            assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
            results.push({browser:name,version:browser.version(),...result});console.log(`PASS ${name}/${rate}: CD-DA WASM, stereo interpolation, scheduled controls, lifecycle and Mixer`);
          }finally{await page.close();}
        }
        for(const execution of ['main','worker']){
          const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1280,height:900}}),errors=[],badResponses=[];page.setDefaultTimeout(30000);
          page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)badResponses.push({url:response.url(),status:response.status()});});
          try{
            const result=await playgroundCheck(page,origin,execution);assert.deepEqual(errors,[]);assert.deepEqual(badResponses,[]);
            playground.push({browser:name,version:browser.version(),...result});console.log(`PASS ${name}/${execution}: real PC Engine Playground, Virtual Files, CD-DA strip and Stop`);
          }catch(error){console.error(`${name}/${execution} host diagnostics`,await page.evaluate(()=>({console:document.getElementById('consoleOutput')?.textContent,status:document.getElementById('status')?.textContent,runtime:window.__cddaPlayground?.runtime.getState()})).catch(()=>null));throw error;}
          finally{await page.close();}
        }
      }finally{await browser.close();}
    }
    const report={schemaVersion:1,passed:true,physicalOutputMuted:true,results,playground,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:sha(await fs.readFile(__filename))};
    if(out)await fs.writeFile(path.resolve(out),JSON.stringify(report,null,2)+'\n');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
