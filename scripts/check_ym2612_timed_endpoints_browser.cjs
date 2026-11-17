// SPDX-License-Identifier: BSD-3-Clause
// Independent Main / Worker clients against actual OPN WASM and Worklets.
// Every endpoint connects through a permanent zero gain to the physical output.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const config={root:path.resolve(__dirname,'..'),engines:'chromium,webkit',out:path.join(os.tmpdir(),'ym2612-timed-endpoints-browser.json')};
for(const argument of process.argv.slice(2)){
  const match=/^--(root|engines|out)=(.+)$/.exec(argument);assert(match,`Unknown argument ${argument}`);config[match[1]]=match[2];
}
config.root=path.resolve(config.root);
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const mime={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.html':'text/html','.json':'application/json'};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    if(pathname==='/'){response.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Muted YM2612 endpoint check</title>');return;}
    const file=path.resolve(config.root,'.'+pathname);
    if(!file.startsWith(config.root+path.sep)){response.writeHead(403).end();return;}
    response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(await fs.readFile(file));
  }catch{response.writeHead(404).end();}
});

async function auditClient(client){
  const snapshot=await client.captureState();
  const plan=client.build(b=>{b.setOperator(0,0,{multi:3});b.atSample(4410).setOperator(0,0,{tl:17});});
  client.write(0,0x30,0x72);
  const compiled=await client.compile(plan);
  if(compiled[0].value!==0x73||compiled[0].port!==0||compiled[1].offsetSeconds!==.1)throw Error('Compiled partial update or reference timing mismatch');
  const reset=await client.compile(plan,{initialState:'reset'});
  if(reset[0].value!==3)throw Error('Reset compilation should start from hardware reset registers');
  const a=await client.compile(plan,{initialState:snapshot});
  const b=await client.compile(plan,{initialState:snapshot});
  if(JSON.stringify(a)!==JSON.stringify(b))throw Error('Snapshot reuse changed compilation');
  const receipt=await client.schedule(plan,{name:'audit'});
  let captured;
  for(let turn=0;turn<200;turn++){
    captured=await client.captureState();
    if(captured.frame>=receipt.startFrame+Math.ceil(.1*receipt.sampleRate))break;
    await new Promise(resolve=>setTimeout(resolve,4));
  }
  if(captured.registers[0][0x30]!==0x73||captured.registers[0][0x40]!==17)throw Error('Worklet execution differs from compiled writes');
  // The second partial update sees a manual DT write performed after admission.
  const future=client.build(b=>b.atSeconds(.1).setOperator(0,0,{multi:5}));
  const accepted=await client.schedule(future,{name:'audit'});
  client.write(0,0x30,0x62);
  for(let turn=0;turn<200;turn++){
    captured=await client.captureState();
    if(captured.frame>=accepted.startFrame+Math.ceil(.1*accepted.sampleRate))break;
    await new Promise(resolve=>setTimeout(resolve,4));
  }
  if(captured.registers[0][0x30]!==0x65)throw Error('Scheduled partial update overwrote later manual DT');
  const repeat=client.build(b=>b.keyOn(0));
  const repeating=await client.schedule(repeat,{name:'repeat',repeatSeconds:.02});
  let before;
  for(let turn=0;turn<200;turn++){
    before=await client.captureState();
    if(before.keyMasks[0]===15&&before.frame>=repeating.startFrame)break;
    await new Promise(resolve=>setTimeout(resolve,4));
  }
  let rejected=false;try{await client.schedule(repeat,{name:'repeat',repeatSeconds:0});}catch{rejected=true;}
  if(!rejected)throw Error('Invalid replacement was accepted');
  if(await client.clearSchedule('repeat')!==true)throw Error('Rejected replacement removed an existing reservation');
  const after=await client.captureState();
  if(after.keyMasks[0]!==15||after.frame<before.frame)throw Error('Key writes did not execute while capturing');
  client.keyOff(0);
  return {sampleRate:snapshot.sampleRate,engine:snapshot.engine,compiled:compiled.map(({port,register,value,offsetSeconds})=>({port,register,value,offsetSeconds})),partialAfterManual:captured.registers[0][0x30],snapshotReusable:true,invalidReplacementKept:true};
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
        for(const rate of [44100,48000])for(const engine of ['ymfm','nuked'])for(const execution of ['main','worker']){
          const row=await page.evaluate(async({rate,engine,execution,auditSource})=>{
            const context=new AudioContext({sampleRate:rate}),mute=context.createGain();mute.gain.value=0;mute.connect(context.destination);await context.resume();
            const {createOpnAudio}=await import('/tetorica_src/runtime/playground_opn_audio.js');
            const endpoint=await createOpnAudio(context,mute,'ym2612',{engine});
            let client,worker,url;
            try{
              let result;
              if(execution==='main'){
                const {createOpnClient}=await import('/tetorica_src/runtime/playground_opn.js');
                client=createOpnClient('ym2612',endpoint.port,{engine});
                result=await (0,eval)(`(${auditSource})`)(client);
              }else{
                const source=`import {createOpnClient} from ${JSON.stringify(location.origin+'/tetorica_src/runtime/playground_opn.js')};\nconst auditClient=${auditSource};\nself.onmessage=async({data})=>{const client=createOpnClient('ym2612',data.port,{engine:data.engine});try{postMessage({result:await auditClient(client)});}catch(error){postMessage({error:String(error.stack)});}finally{client.dispose();}};`;
                url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));worker=new Worker(url,{type:'module'});
                result=await new Promise((resolve,reject)=>{
                  worker.onmessage=({data})=>data.error?reject(Error(data.error)):resolve(data.result);worker.onerror=event=>reject(Error(event.message));
                  worker.postMessage({port:endpoint.port,engine},[endpoint.port]);
                });
              }
              if(mute.gain.value!==0)throw Error('Physical output mute changed');
              return {...result,requestedRate:rate,execution,silent:true};
            }finally{client?.dispose();worker?.terminate();if(url)URL.revokeObjectURL(url);endpoint.dispose();mute.disconnect();await context.close();}
          },{rate,engine,execution,auditSource:auditClient.toString()});
          assert.equal(row.sampleRate,rate);assert.equal(row.engine,engine);results.push({browser:browserName,...row});
          console.log(`${browserName} ${engine} ${execution} ${rate}: passed (muted)`);
        }
        assert.deepEqual(errors,[]);await page.close();
      }finally{await browser.close();}
    }
    const report={passed:true,elapsedMs:Date.now()-started,cases:results};await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log(`Saved ${config.out}`);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
