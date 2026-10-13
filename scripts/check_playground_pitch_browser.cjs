// Serve docs on port 8093. Optional URL argument selects ?chip=ym2203/ym2610/ym2608.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/playground.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__pitchTest={runtime,megaDrive};'});});
  const url=process.argv[2]||'http://localhost:8093/playground/index.html';const selected=new URL(url).searchParams.get('chip')||'ym2612';
  await page.goto(url);await page.waitForFunction(()=>window.__pitchTest&&window.monaco?.editor?.getEditors().length);
  const results=[];
  for(const execution of ['main','worker']){
   const prefix=`setBpm(120);fm.setPreset(CH1,FM_PRESETS['one-op-basic']);`;
   await page.evaluate(async ({source,execution})=>window.__pitchTest.runtime.playSource(source,{execution}),{source:prefix+`await play('A4',{seconds:.05});`,execution});
   await page.evaluate(async ({execution,selected})=>{
    await window.__pitchTest.runtime.playSource(`
     const verify=(p,expected)=>{const actual=p.fnum*fm.clock*2**(p.block-1)/((${selected==='ym2203'?72:144})*2**20);if(Math.abs(actual-expected)>.6)throw Error('Wrong pitch '+actual);};
     verify(noteToBlockFnum('A4'),440);verify(hzToBlockFnum(440),440);verify(noteLerp('A4','A5',.5),440*2**(.5));
     const original=fm.clock;await fm.setClock(Math.round(original*.5));
     try{verify(noteToBlockFnum(69),440);verify(hzToBlockFnum(440),440);}finally{await fm.setClock(original);}
     console.log('PITCH_HELPER_PASS ${execution}');`,{execution});
   },{execution,selected});
   await page.waitForFunction(execution=>document.getElementById('consoleOutput').textContent.includes('PITCH_HELPER_PASS '+execution),execution);
   if(selected!=='ym2612'){results.push({execution,selected});continue;}
   const cases=[
    ['setNote',`fm.noteOn(CH1,'A4');await sleep(.5);fm.keyOff(CH1);`,440],
    ['play',`await play('A4',{seconds:.5});`,440],
    ['midi',`const out=midi.output('tetorica-ym2612');await out.setVoice(FM_PRESETS['one-op-basic']);await out.play('A4',{duration:1});`,440],
    ['bend',`const out=midi.output('tetorica-ym2612');await out.setVoice(FM_PRESETS['one-op-basic']);await out.noteOn(69);await out.pitchBend(1);await sleep(.5);await out.noteOff(69);await out.pitchBend(0);`,440*2**(2/12)],
    ['clock',`const original=fm.clock;await fm.setClock(Math.round(original*.5));try{await play('A4',{seconds:.5});}finally{await fm.setClock(original);}`,440],
   ];
   for(const [name,body,expected] of cases){
    const actual=await page.evaluate(async ({source,execution})=>{
     const {runtime,megaDrive}=window.__pitchTest;const port=megaDrive.node.port;const captureId='pitch:'+Math.random();
     const captured=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{port.removeEventListener('message',listener);reject(Error('Capture timed out'));},8000);const listener=({data})=>{if(data.type!=='capture-stopped'||data.captureId!==captureId)return;clearTimeout(timer);port.removeEventListener('message',listener);resolve(data.left);};port.addEventListener('message',listener);});
     port.postMessage({type:'start-capture',captureId});try{await runtime.playSource(source,{execution});}finally{port.postMessage({type:'stop-capture'});}
     const pcm=await captured,rate=megaDrive.audioContext.sampleRate;
     const begin=Math.round(rate*.15),end=Math.round(rate*.35);if(pcm.length<end)throw Error('Capture too short');
     let mean=0;for(let i=begin;i<end;i++)mean+=pcm[i];mean/=end-begin;
     let crossings=0,peak=0;for(let i=begin+1;i<end;i++){if(pcm[i-1]<mean&&pcm[i]>=mean)crossings++;peak=Math.max(peak,Math.abs(pcm[i]-mean));}
     if(peak<.001)throw Error('Silent capture');return crossings*rate/(end-begin);
    },{source:prefix+body,execution});
    assert(Math.abs(actual-expected)<8,JSON.stringify({execution,name,actual,expected}));results.push({execution,name,actual});
   }
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
