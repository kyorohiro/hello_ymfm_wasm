// Verify the installed public WonderSwan endpoint, Mixer and transferred port.
// All physical output is muted downstream of the measured graph.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const args=process.argv.slice(2),directory=path.resolve(args[0]??'dist/fm2612');
if(args.length>2)throw Error('Usage: check_wonderswan_worklet_browser.cjs [PACKAGE_DIRECTORY] [REPORT.json]');
const out=args[1]&&path.resolve(args[1]),served=new Map();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<button id="run">Check WonderSwan</button>');return;}
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(directory,'.'+pathname);
    if(!file.startsWith(directory+path.sep))throw Error('Invalid package path');
    const bytes=await fs.readFile(file),name=path.relative(directory,file),hash=sha(bytes);
    if(served.has(name)&&served.get(name).sha256!==hash)throw Error('Package changed during browser check');
    served.set(name,{bytes:bytes.length,sha256:hash});
    res.writeHead(200,{'Content-Type':file.endsWith('.wasm')?'application/wasm':'text/javascript','Cache-Control':'no-store'}).end(bytes);
  }catch(error){res.writeHead(404).end(error.message);}
});
(async()=>{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,results=[];
  try{
    for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){
      const browser=await type.launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try{
        const page=await browser.newPage(),errors=[];page.setDefaultTimeout(60000);
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(origin);
        await page.evaluate(()=>{
          document.getElementById('run').onclick=()=>{window.check=(async()=>{
            const {createSoundChip,SoundChipMixer}=await import('/soundchip.js');
            const {WonderSwanSynth,WonderSwanWorkletTransport}=await import('/wonderswansynth.js');
            const check=(ok,message)=>{if(!ok)throw Error(message);};
            const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
            const context=new AudioContext({sampleRate:48000});await context.resume();
            const meter=context.createAnalyser();meter.fftSize=2048;
            const silence=context.createGain();silence.gain.value=0;meter.connect(silence);silence.connect(context.destination);
            const splitter=context.createChannelSplitter(2),left=context.createAnalyser(),right=context.createAnalyser();
            left.fftSize=right.fftSize=2048;meter.connect(splitter);splitter.connect(left,0);splitter.connect(right,1);left.connect(silence);right.connect(silence);
            const mixer=new SoundChipMixer();let chip,peer,transport;
            async function measure(){
              // Wait for an entire fresh analyser window in audio time. Wall
              // time alone can expire before a cold audio graph starts pulling.
              const after=context.currentTime+.065,deadline=performance.now()+5000;
              while(context.currentTime<after){check(performance.now()<deadline,'Audio clock did not advance');await wait(15);}
              const l=new Float32Array(2048),r=new Float32Array(2048);let lp=0,rp=0;
              for(let n=0;n<6;n++){left.getFloatTimeDomainData(l);right.getFloatTimeDomainData(r);for(const v of l){check(Number.isFinite(v),'Non-finite left PCM');lp=Math.max(lp,Math.abs(v));}for(const v of r){check(Number.isFinite(v),'Non-finite right PCM');rp=Math.max(rp,Math.abs(v));}await wait(20);}
              return {left:lp,right:rp};
            }
            const near=(actual,expected,label)=>check(Math.abs(actual-expected)<Math.max(1e-6,expected*.01),`${label}: ${actual} vs ${expected}`);
            try{
              chip=await createSoundChip('wonderswan',{execution:'worklet',audioContext:context,sampleRate:44100,mixer,outputNode:meter,id:'ws-browser'});
              check(chip.clock===3072000&&chip.sampleRate()===context.sampleRate,'Actual clock/output rate metadata');
              transport=new WonderSwanWorkletTransport(chip);
              const ws=new WonderSwanSynth({transport,clock:chip.clock});ws.initialize();ws.noteOn(0,'A4');
              await transport.flush();await transport.start();
              const base=await measure();check(base.left>.01&&base.right>.01,`Wave must be audible: ${JSON.stringify({base,mix:mixer.get(chip.id),state:context.state,time:context.currentTime,gates:await transport.readRegister(0x90),headphones:await transport.readRegister(0x91),volume:await transport.readRegister(0x88),ram:await transport.readMemory(0)})}`);near(base.left,base.right,'Centered wave');
              mixer.set(chip.id,{volume:.5});const half=await measure();near(half.left,base.left*.5,'Mixer gain applied once');
              mixer.set(chip.id,{pan:-1});const pan=await measure();near(pan.left,half.left,'Left pan gain');check(pan.right<1e-7,'Right pan silence');
              mixer.set(chip.id,{muted:true});const muted=await measure();check(muted.left<1e-7&&muted.right<1e-7,'Mixer mute');
              mixer.set(chip.id,{volume:1,pan:0,muted:false});
              await transport.setChannelMuted(0,true);const channelMute=await measure();check(channelMute.left<1e-7&&channelMute.right<1e-7,'Core mute must not leave a negative DC center');
              await transport.setChannelMuted(0,false);
              peer=await createSoundChip('wonderswan',{execution:'worklet',audioContext:context,mixer,outputNode:meter,id:'ws-peer'});
              const peerTransport=new WonderSwanWorkletTransport(peer);
              await peerTransport.loadMemory(Uint8Array.of(0xab),0x200);check(await peerTransport.readMemory(0x200)===0xab,'RAM upload ACK/readback');
              check(await transport.readMemory(0x200)===0,'Independent chip RAM');
              mixer.set(peer.id,{solo:true});check((await measure()).left<1e-7,'Solo another strip mutes this source');
              mixer.set(peer.id,{solo:false});peerTransport.dispose();await peer.dispose();peer=null;
              ws.allNotesOff();await transport.flush();
              const future=context.currentTime+.4;
              await transport.scheduleWrites([{time:future,register:0x90,value:1}]);await transport.stop();await transport.start();
              await wait(450);check((await transport.readRegister(0x90)&15)===0,'Stop cancels future gates');
              const cancelled=await measure();check(cancelled.left<1e-7,'Cancelled schedule stays silent after restart');
              const pcm=new Uint8Array(12000);for(let i=0;i<pcm.length;i++)pcm[i]=Math.round(128+80*Math.sin(2*Math.PI*440*i/12000));
              ws.initialize();ws.setVoiceMode(true);ws.writeVoice(128);await transport.flush();
              const start=context.currentTime+.2;
              const entries=[{time:start,register:0x90,value:0x22},...Array.from(pcm,(value,i)=>({time:start+i/12000,register:0x89,value})),{time:start+1,register:0x90,value:0}];
              check(await transport.scheduleWrites(entries)===12002,'All timed PCM writes accepted');
              await wait(350);const voice=await measure();check(voice.left>.01&&voice.right>.01,'Timed Voice PCM is audible');
              await wait(1000);const voiceEnded=await measure();check(voiceEnded.left<1e-7&&voiceEnded.right<1e-7,'Scheduled PCM gate ends in silence');
              check((await transport.readRegister(0x90)&15)===0,'Timed gate off applied');
              const source=`import {WonderSwanSynth,WonderSwanWorkletTransport} from '${location.origin}/wonderswansynth.js';
                self.onmessage=async({data:port})=>{let transport;try{
                  transport=new WonderSwanWorkletTransport(port);await transport.loadMemory(Uint8Array.of(0x76),0x3fff);
                  if(await transport.readMemory(0x3fff)!==0x76)throw Error('Worker RAM ACK');
                  const ws=new WonderSwanSynth({transport});ws.initialize();ws.noteOn(0,'A4');await transport.flush();self.postMessage('playing');
                  await new Promise(resolve=>setTimeout(resolve,450));ws.allNotesOff();await transport.flush();
                  if((await transport.readRegister(0x90)&15)!==0)throw Error('Worker gate off');
                  transport.dispose();port.close();self.postMessage('done');
                }catch(error){transport?.dispose();self.postMessage({error:error.message});}};`;
              const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});
              let workerAudio;
              try{
                let playingResolve,doneResolve,reject;
                const playing=new Promise(resolve=>playingResolve=resolve),done=new Promise((resolve,fail)=>{doneResolve=resolve;reject=fail;});
                worker.onerror=e=>reject(Error(e.message));worker.onmessage=({data})=>{if(data?.error)reject(Error(data.error));else if(data==='playing')playingResolve();else if(data==='done')doneResolve();};
                const port=chip.createTransportPort();worker.postMessage(port,[port]);
                await Promise.race([playing,done,wait(8000).then(()=>{throw Error('Worker did not initialize');})]);
                workerAudio=await measure();check(workerAudio.left>.01,'Transferred-port Worker Synth is audible');
                await Promise.race([done,wait(8000).then(()=>{throw Error('Worker did not finish');})]);
              }finally{worker.terminate();URL.revokeObjectURL(url);}
              const stopped=await measure();check(stopped.left<1e-7&&stopped.right<1e-7,'Worker note off is silent');
              transport.dispose();await chip.dispose();chip=null;
              check(context.state!=='closed','Borrowed context remains owned by caller');
              const result={base,half,pan,muted,channelMute,voice,voiceEnded,workerAudio,stopped,actualSampleRate:context.sampleRate,physicalOutputMuted:true};
              return result;
            }finally{transport?.dispose();await peer?.dispose();await chip?.dispose();meter.disconnect();splitter.disconnect();left.disconnect();right.disconnect();silence.disconnect();await context.close();}
          })();};
        });
        await page.click('#run');const result=await page.evaluate(()=>window.check);
        assert.deepEqual(errors,[]);results.push({browser:name,version:browser.version(),...result});
        console.log(`PASS ${name}: WonderSwan real Worklet/Mixer/timed PCM/Worker/disposal`);
      }finally{await browser.close();}
    }
    const report={schemaVersion:1,passed:true,directory,physicalOutputMuted:true,results,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:sha(await fs.readFile(__filename))};
    if(out)await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
