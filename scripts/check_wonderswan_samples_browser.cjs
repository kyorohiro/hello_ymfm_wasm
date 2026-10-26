// Actual Analyzer Samples UI and real WASM preview. A test-only AnalyserNode
// measures the preview before a zero-gain destination, keeping hardware silent.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {chromium,webkit}=require('playwright');
const repository=path.resolve(__dirname,'..'),args=process.argv.slice(2);
if(args.includes('--help')){console.log('Usage: node scripts/check_wonderswan_samples_browser.cjs [--root=docs-or-flat-analyzer] [--chromium-only] [--out=REPORT.json]');process.exit(0);}
for(const arg of args)if(!arg.startsWith('--root=')&&!arg.startsWith('--out=')&&arg!=='--chromium-only')throw Error(`Unknown argument: ${arg}`);
const root=path.resolve(repository,args.find(v=>v.startsWith('--root='))?.slice(7)??'docs');
const reportPath=args.find(v=>v.startsWith('--out='))?.slice(6);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex'),servedSources=new Map();
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm'};
const server=http.createServer(async(request,response)=>{
  try{
    const pathname=decodeURIComponent(new URL(request.url,'http://local').pathname);
    if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}
    let file=path.resolve(root,'.'+pathname);
    if(file!==root&&!file.startsWith(root+path.sep))throw Error('Outside test root');
    if((await fs.stat(file)).isDirectory())file=path.join(file,'index.html');
    const body=await fs.readFile(file);
    servedSources.set(path.relative(root,file).replaceAll(path.sep,'/'),{bytes:body.length,sha256:sha256(body)});
    response.setHeader('Content-Type',mime[path.extname(file)]??'application/octet-stream');response.end(body);
  }catch(error){response.writeHead(404).end(error.message);}
});
// No preview data is injected. We retain actual source buffers and read actual
// rendered samples upstream of the muting gain, as well as observing lifecycle.
const installProbe=()=>{
  const Original=window.AudioContext??window.webkitAudioContext;
  const state={contexts:[],sources:[],starts:0,stops:0,holdNextResume:false,releaseResume:null,copied:null};
  window.__wsSampleTest=state;
  class TestAudioContext extends Original{
    constructor(...args){
      super(...args);const context=this;
      const analyser=this.createAnalyser();analyser.fftSize=2048;
      const silence=this.createGain();silence.gain.value=0;
      analyser.connect(silence);silence.connect(this.destination);
      const meter={analyser,silence,sampleRate:this.sampleRate};state.contexts.push(meter);
      const originalCreate=this.createBufferSource.bind(this);
      this.createBufferSource=()=>{
        const source=originalCreate(),record={source,starts:0,stops:0,destinationMuted:false,meter};
        state.sources.push(record);
        const connect=source.connect.bind(source),start=source.start.bind(source),stop=source.stop.bind(source);
        source.connect=(destination,...rest)=>{
          if(destination!==context.destination)throw Error('Unexpected preview audio route');
          record.destinationMuted=true;return connect(analyser,...rest);
        };
        source.start=(...values)=>{record.starts++;state.starts++;return start(...values);};
        source.stop=(...values)=>{record.stops++;state.stops++;return stop(...values);};
        return source;
      };
      const resume=this.resume.bind(this);
      this.resume=async()=>{
        await resume();
        if(state.holdNextResume){state.holdNextResume=false;await new Promise(resolve=>{state.releaseResume=()=>{state.releaseResume=null;resolve();};});}
      };
    }
  }
  Object.defineProperty(window,'AudioContext',{configurable:true,value:TestAudioContext});
  if(window.webkitAudioContext)Object.defineProperty(window,'webkitAudioContext',{configurable:true,value:TestAudioContext});
  try{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{state.copied=String(value);}}});}catch{}
  state.snapshot=()=>({starts:state.starts,stops:state.stops,sourceCount:state.sources.length,
    sources:state.sources.map(record=>{
      const buffer=record.source.buffer,channels=buffer?Array.from({length:buffer.numberOfChannels},(_,channel)=>{
        const values=buffer.getChannelData(channel);let sum=0,square=0,peak=0,bad=0;
        for(const value of values){if(!Number.isFinite(value))bad++;else{sum+=value;square+=value*value;peak=Math.max(peak,Math.abs(value));}}
        return{frames:values.length,peak,bad,mean:sum/values.length,acRms:Math.sqrt(Math.max(0,square/values.length-(sum/values.length)**2))};
      }):[];
      return{starts:record.starts,stops:record.stops,destinationMuted:record.destinationMuted,sampleRate:buffer?.sampleRate,channels};
    }),copied:state.copied,held:!!state.releaseResume});
  state.signal=()=>{
    const meter=state.sources.at(-1)?.meter;if(!meter)return null;
    const values=new Float32Array(meter.analyser.fftSize);meter.analyser.getFloatTimeDomainData(values);
    let peak=0,square=0,bad=0;for(const value of values){if(!Number.isFinite(value))bad++;else{peak=Math.max(peak,Math.abs(value));square+=value*value;}}
    return{peak,rms:Math.sqrt(square/values.length),bad,mute:meter.silence.gain.value};
  };
};
async function download(page,button){
  const [event]=await Promise.all([page.waitForEvent('download'),button.click()]);
  const bytes=await fs.readFile(await event.path());return{name:event.suggestedFilename(),bytes};
}
async function waitForSignal(page){
  await page.waitForFunction(()=>{const signal=window.__wsSampleTest.signal();return signal?.rms>.001;});
  const signal=await page.evaluate(()=>window.__wsSampleTest.signal());assert.equal(signal.bad,0);assert.equal(signal.mute,0);return signal;
}
async function runBrowser(name,type,origin,analyzerPath,fixture,waves){
  const browser=await type.launch({headless:true,args:name==='chromium'?['--autoplay-policy=no-user-gesture-required']:[]});
  try{
    const page=await browser.newPage({serviceWorkers:'block',viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[];
    page.setDefaultTimeout(35000);page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(installProbe);
    await page.goto(origin+analyzerPath+'/index.html');await page.waitForFunction(()=>window.__wsSampleTest);
    const load=async(filename)=>{
      await page.locator('#fileInput').setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from(fixture)});
      await page.waitForFunction(filename=>document.getElementById('status').textContent.startsWith('Parsed '+filename+' ')&&!document.getElementById('sampleExplorerTab').disabled,filename);
    };
    const analyze=async()=>{
      await page.locator('#sampleExplorerTab').click();
      await page.locator('#sampleExplorerPanel').getByRole('button',{name:'Analyze samples',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('[data-wonderswan-wave-id]').length===2);
      assert.equal(await page.locator('[data-wonderswan-wave-id]').count(),2,'Shared channels must deduplicate identical wave RAM');
    };
    await load('original-wonderswan-wave-samples.vgm');await analyze();
    const expected=waves.map(bytes=>bytes.flatMap(value=>[value&15,value>>>4]));
    const rows=page.locator('[data-wonderswan-wave-id]'),waveResults=[];
    for(let index=0;index<2;index++){
      const row=rows.nth(index);await row.locator('summary').click();
      const canvas=row.locator('canvas[aria-label="WonderSwan wave RAM: 32 unsigned 4-bit values"]');
      await page.waitForFunction(element=>{const bytes=element.getContext('2d').getImageData(0,0,element.width,element.height).data;return bytes.some((value,index)=>index%4===3&&value>0);},await canvas.elementHandle());
      const code=await row.locator('textarea[aria-label="WonderSwan setWaveform JavaScript"]').inputValue();
      const calls=[];new Function('ws',code)({setWaveform:(...values)=>calls.push(values)});
      assert.equal(calls.length,1,'Exported code must call ws.setWaveform once');
      assert.deepEqual(calls[0].find(value=>Array.isArray(value)),expected[index],'Reusable code must retain low-nibble-first wave order');
      await row.getByRole('button',{name:'Copy setWaveform JavaScript',exact:true}).click();
      assert.equal(await page.evaluate(()=>window.__wsSampleTest.copied),code,'Copy must preserve the reusable code');
      const json=await download(page,row.getByRole('button',{name:'Save waveform JSON',exact:true}));
      assert.match(json.name,/^wonderswan-wave-.*\.json$/);
      const content=JSON.parse(json.bytes);assert.equal(content.chip,'wonderswan');assert.equal(content.kind,'wave');
      assert.equal(content.schemaVersion,1);assert.equal(content.representation,'written-wave-ram');
      assert.deepEqual(content.waveform,expected[index]);assert.deepEqual(content.packedBytes,waves[index]);
      assert.equal(content.timebase,44100);assert(content.observations.length>=2,'Repeated use must be retained without duplicating waveform definitions');
      assert.equal(calls[0][0],content.observations[0].channel-1,'Reusable code must address the selected zero-based channel');
      const before=await page.evaluate(()=>window.__wsSampleTest.starts);
      await row.getByRole('button',{name:'Preview wave (1 s)',exact:true}).click();
      await page.waitForFunction(before=>window.__wsSampleTest.starts>before,before);
      const signal=await waitForSignal(page),probe=await page.evaluate(()=>window.__wsSampleTest.snapshot()),source=probe.sources.at(-1);
      assert.equal(source.destinationMuted,true);assert.equal(source.channels.length,2);
      for(const channel of source.channels){assert.equal(channel.bad,0);assert(channel.acRms>.001);assert.equal(channel.frames,source.sampleRate,'Preview must last one second');}
      const stopBefore=probe.stops;
      await page.locator('#sampleExplorerPanel').getByRole('button',{name:'Stop preview',exact:true}).click();
      assert((await page.evaluate(()=>window.__wsSampleTest.stops))>stopBefore,'Stop preview must stop the actual AudioBufferSourceNode');
      const wav=await download(page,row.getByRole('button',{name:'Save preview WAV (1 s)',exact:true}));
      assert.equal(wav.bytes.subarray(0,4).toString(),'RIFF');assert.equal(wav.bytes.subarray(8,12).toString(),'WAVE');
      assert.equal(wav.bytes.readUInt16LE(22),2);assert.equal(wav.bytes.readUInt32LE(24),source.sampleRate);
      assert(wav.bytes.length>source.sampleRate*4,'WAV must contain full stereo preview PCM');
      let occurrenceChange=null;
      if(index===0){
        const selected=content.observations.findIndex(event=>event.channel!==content.observations[0].channel);
        assert(selected>0,'Shared waveform must retain observations from distinct channels');
        await row.getByRole('button',{name:'Preview wave (1 s)',exact:true}).click();await waitForSignal(page);
        const stopBeforeSelection=await page.evaluate(()=>window.__wsSampleTest.stops);
        await row.locator('select').selectOption(String(selected));
        assert((await page.evaluate(()=>window.__wsSampleTest.stops))>stopBeforeSelection,'Changing occurrence must stop the current audition');
        const updatedCode=await row.locator('textarea').inputValue(),updatedCalls=[];
        new Function('ws',updatedCode)({setWaveform:(...values)=>updatedCalls.push(values)});
        assert.equal(updatedCalls[0][0],content.observations[selected].channel-1);
        assert.deepEqual(updatedCalls[0][1],expected[index]);
        occurrenceChange={index:selected,channel:content.observations[selected].channel,code:updatedCode,stopped:true};
      }
      waveResults.push({wave:index+1,code,json:{name:json.name,bytes:json.bytes.length,sha256:sha256(json.bytes),content},preview:{source,signal},wav:{name:wav.name,bytes:wav.bytes.length,sha256:sha256(wav.bytes)},occurrenceChange});
    }
    const first=rows.first(),preview=first.getByRole('button',{name:'Preview wave (1 s)',exact:true});
    // Hold the real context resume promise, then exercise user cancellation.
    let startBefore=await page.evaluate(()=>{window.__wsSampleTest.holdNextResume=true;return window.__wsSampleTest.starts;});
    await preview.click();await page.waitForFunction(()=>window.__wsSampleTest.releaseResume);
    await page.locator('#sampleExplorerPanel').getByRole('button',{name:'Stop preview',exact:true}).click();
    await page.evaluate(()=>window.__wsSampleTest.releaseResume());await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>window.__wsSampleTest.starts),startBefore,'Cancelled pending preview must not start after context resume');
    // Replacing the source cancels an in-flight preview and clears old waves.
    startBefore=await page.evaluate(()=>{window.__wsSampleTest.holdNextResume=true;return window.__wsSampleTest.starts;});
    await preview.click();await page.waitForFunction(()=>window.__wsSampleTest.releaseResume);
    await load('replacement-wonderswan-wave-samples.vgm');
    assert.equal(await page.locator('[data-wonderswan-wave-id]').count(),0,'Loading a new file must clear sample observations');
    await page.evaluate(()=>window.__wsSampleTest.releaseResume());await page.waitForTimeout(150);
    assert.equal(await page.evaluate(()=>window.__wsSampleTest.starts),startBefore,'Replaced-source preview must not start later');
    await analyze();await rows.first().locator('summary').click();
    await rows.first().getByRole('button',{name:'Preview wave (1 s)',exact:true}).click();await waitForSignal(page);
    const stopBefore=await page.evaluate(()=>window.__wsSampleTest.stops);
    await load('reset-playing-wonderswan-wave-samples.vgm');
    assert((await page.evaluate(()=>window.__wsSampleTest.stops))>stopBefore,'File reset must stop an active preview');
    assert.deepEqual(errors,[],'Analyzer Samples page errors');
    await page.screenshot({path:`/private/tmp/wonderswan-samples-${name}.png`,fullPage:true});
    return{browser:name,version:browser.version(),uniqueWaves:2,waveResults,lifecycle:{stop:true,pendingStop:true,pendingFileReset:true,activeFileReset:true},pageErrors:errors};
  }finally{await browser.close();}
}
(async()=>{
  let analyzerPath='';try{await fs.access(path.join(root,'vgm_analyzer','vgm_analyzer.js'));analyzerPath='/vgm_analyzer';}catch{await fs.access(path.join(root,'vgm_analyzer.js'));}
  const{createWonderSwanSampleVgm,WONDER_SWAN_SAMPLE_WAVES}=await import(pathToFileURL(path.join(repository,'test/helpers/wonderswan_sample_vgm_fixture.mjs')).href);
  const fixture=createWonderSwanSampleVgm();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const results=[],engines=[['chromium',chromium],...(args.includes('--chromium-only')?[]:[['webkit',webkit]])];
  try{for(const[name,type]of engines){results.push(await runBrowser(name,type,`http://127.0.0.1:${server.address().port}`,analyzerPath,fixture,WONDER_SWAN_SAMPLE_WAVES));console.log(`WonderSwan Samples ${name}: nibble order, content deduplication, waveform canvas, code/JSON/WAV export, real muted preview and cancellation passed.`);}}
  finally{await new Promise(resolve=>server.close(resolve));}
  const sourceFiles=Object.fromEntries([...servedSources].sort(([a],[b])=>a.localeCompare(b)));
  const testSources=Object.fromEntries(await Promise.all(['scripts/check_wonderswan_samples_browser.cjs','test/helpers/wonderswan_sample_vgm_fixture.mjs'].map(async file=>[file,sha256(await fs.readFile(path.join(repository,file)))])));
  const report={format:'tetorica-wonderswan-samples-browser-1',root,physicalOutput:'zero-gain destination; actual rendered preview PCM measured upstream',fixture:{bytes:fixture.length,sha256:sha256(fixture)},sourceFiles,testSources,results};
  if(reportPath)await fs.writeFile(path.resolve(reportPath),JSON.stringify(report,null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
