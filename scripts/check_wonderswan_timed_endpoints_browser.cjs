// SPDX-License-Identifier: BSD-3-Clause
// Independent Main / Worker clients against actual WonderSwan WASM and Worklets.
// Every endpoint connects through a permanent zero gain to the physical output.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'..'),engines:'chromium,webkit',out:path.join(os.tmpdir(),'wonderswan-timed-endpoints-browser.json'),runtime:'/tetorica_src/runtime'};
for(const argument of process.argv.slice(2)){
  const match=/^--(root|engines|out|runtime)=(.+)$/.exec(argument);assert(match,`Unknown argument ${argument}`);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json'};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/'){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Muted WonderSwan endpoint check</title>');return;}
    const file=path.resolve(config.root,'.'+pathname);
    if(!file.startsWith(config.root+path.sep)){response.writeHead(403).end();return;}
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(await fs.readFile(file));
  }catch{response.writeHead(404).end();}
});

async function auditClient(client){
  client.initialize();
  const snapshot=await client.captureState();
  const plan=client.build(b=>{b.setVolume(0,13,9);b.atSample(4410).setPan(0,7,11);});
  const compiled=await client.compile(plan),local=await client.compile(plan,{initialState:'client'});
  if(compiled.at(-1).value!==0x7b||compiled.at(-1).offsetSeconds!==.1)throw Error('Register conversion or timing mismatch');
  if(JSON.stringify(await client.compile(plan,{initialState:snapshot}))!==JSON.stringify(compiled)||JSON.stringify(local)!==JSON.stringify(compiled))throw Error('Snapshot/client compilation mismatch');
  const waitFor=async(frame)=>{for(let i=0;i<250;i++){const state=await client.captureState();if(state.frame>=frame)return state;await new Promise(resolve=>setTimeout(resolve,4));}throw Error('Audio timeline did not advance');};
  const accepted=await client.schedule(plan,{name:'parameters'});
  const state=await waitFor(accepted.startFrame+Math.ceil(.1*accepted.sampleRate));
  if(state.state.registers[8]!==0x7b)throw Error('Worklet differs from compile result');
  const future=client.build(b=>b.atSeconds(.05).setNoise({enabled:true,type:3,reset:true}));
  const next=await client.schedule(future,{name:'parameters'});client.setSweep({enabled:true,step:1,time:2});client.keyOn(0);
  const changed=await waitFor(next.startFrame+Math.ceil(.05*next.sampleRate));
  if((changed.state.registers[16]&0xc1)!==0xc1)throw Error('Partial update overwrote later manual mode/Gate');
  const gates=client.build(b=>b.keyOn(2));await client.schedule(gates,{name:'repeat',repeatSeconds:.02});
  let rejected=false;try{await client.schedule(client.build(b=>b.setVolume(0,16)),{name:'repeat'});}catch{rejected=true;}
  if(!rejected||!await client.clearSchedule('repeat'))throw Error('Invalid replacement replaced existing reservation');
  const held=await client.schedule(gates,{name:'held'});await waitFor(held.startFrame+128);
  client.keyOn(2);await client.clearSchedule('held');
  if(!((await client.captureState()).state.registers[16]&4))throw Error('Stale clear stopped a newer manual Gate');
  client.allNotesOff();
  return {sampleRate:snapshot.sampleRate,snapshotReusable:true,partialAfterManual:changed.state.registers[16],invalidReplacementKept:true,compiledWrites:compiled.length,staleGateProtected:true};
}

(async()=>{
  const results=[],started=Date.now();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    for(const browserName of engines){
      const browser=await ({chromium,webkit}[browserName]).launch({headless:true,...(browserName==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try{
        const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
        await page.goto(base);
        for(const rate of [44100,48000])for(const execution of ['main','worker']){
          const row=await page.evaluate(async({rate,execution,auditSource,runtime})=>{
            const context=new AudioContext({sampleRate:rate}),mute=context.createGain();mute.gain.value=0;mute.connect(context.destination);await context.resume();
            const {createWonderSwanAudio}=await import(runtime+'/playground_wonderswan_audio.js');
            const endpoint=await createWonderSwanAudio(context,mute);
            let client,worker,url;
            try{
              let result;
              if(execution==='main'){
                const {createWonderSwanClient}=await import(runtime+'/playground_wonderswan.js');
                client=createWonderSwanClient(endpoint.port);
                result=await (0,eval)(`(${auditSource})`)(client);
              }else{
                const source=`import {createWonderSwanClient} from ${JSON.stringify(location.origin+runtime+'/playground_wonderswan.js')};\nconst auditClient=${auditSource};\nself.onmessage=async({data})=>{const client=createWonderSwanClient(data.port);try{postMessage({result:await auditClient(client)});}catch(error){postMessage({error:String(error.stack)});}finally{client.dispose();}};`;
                url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));worker=new Worker(url,{type:'module'});
                result=await new Promise((resolve,reject)=>{
                  worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);worker.onerror=event=>reject(Error(event.message));
                  worker.postMessage({port:endpoint.port},[endpoint.port]);
                });
              }
              if(mute.gain.value!==0)throw Error('Physical output mute changed');
              return {...result,requestedRate:rate,execution,silent:true};
            }finally{client?.dispose();worker?.terminate();if(url)URL.revokeObjectURL(url);endpoint.dispose();mute.disconnect();await context.close();}
          },{rate,execution,auditSource:auditClient.toString(),runtime:config.runtime.replace(/\/$/,'')});
          assert.equal(row.sampleRate,rate);results.push({browser:browserName,...row});
          console.log(`${browserName} ${execution} ${rate}: passed (muted)`);
        }
        assert.deepEqual(errors,[]);await page.close();
      }finally{await browser.close();}
    }
    const report={passed:true,elapsedMs:Date.now()-started,cases:results};await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`Saved ${config.out}`);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
