// SPDX-License-Identifier: BSD-3-Clause
// Actual UI/output gain/New Cassette checks. A permanent zero-gain speaker gate is installed before audio initialization.
const assert=require('node:assert/strict');
const{createHash}=require('node:crypto');
const fs=require('node:fs/promises'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const{pathToFileURL}=require('node:url');
const{chromium,webkit}=require('playwright');
const started=Date.now(),repository=path.resolve(__dirname,'..');
const config={root:path.join(repository,'docs'),entry:'/synth-scsp/index.html',engines:'chromium,webkit',
 out:path.join(os.tmpdir(),'scsp-output-level-new-cassette-browser.json'),screenshots:path.join(os.tmpdir(),'scsp-output-level-new-cassette-browser')};
const args=process.argv.slice(2);for(let n=0;n<args.length;n++){const match=/^--(root|entry|engines|out|screenshots)(?:=(.+))?$/.exec(args[n]);assert(match,'Unknown argument '+args[n]);config[match[1]]=match[2]??args[++n];assert(config[match[1]]);}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),served=new Map(),sourceErrors=[],results=[];
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webp':'image/webp','.svg':'image/svg+xml','.md':'text/plain','.scspasm':'text/plain'};
const server=http.createServer(async(request,response)=>{try{let relative=decodeURIComponent(new URL(request.url,'http://localhost').pathname);if(relative==='/favicon.ico'){response.writeHead(204).end();return;}if(relative.endsWith('/'))relative+='index.html';
 const file=path.resolve(config.root,'.'+relative);assert(file.startsWith(config.root+path.sep));const bytes=await fs.readFile(file),asset=path.relative(config.root,file).split(path.sep).join('/'),record={bytes:bytes.length,sha256:sha(bytes)};
 if(served.has(asset)&&served.get(asset).sha256!==record.sha256){sourceErrors.push('Source changed while served: '+asset);throw Error(sourceErrors.at(-1));}served.set(asset,record);
 response.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
 }catch{response.writeHead(404).end();}});
function installSilentAudit(){
 const Context=window.AudioContext??window.webkitAudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,disconnect=AudioNode.prototype.disconnect,post=MessagePort.prototype.postMessage;
 const audit=window.__scspOutputAudit={contexts:[],nodes:[],edges:[],physical:[],commands:[],databases:[],sequence:0};let nodeSequence=0;
 const records=new WeakMap();
 function record(node,name=node.constructor.name){let value=records.get(node);if(!value){value={id:++nodeSequence,node,name,tap:null};records.set(node,value);audit.nodes.push(value);}return value;}
 function tap(node){const value=record(node);if(!node.gain&&!value.name.startsWith('tetorica-'))return;if(value.tap)return;value.tap=node.context.createAnalyser();value.tap.fftSize=8192;connect.call(node,value.tap);}
 window.AudioContext=class extends Context{constructor(options={}){super({...options,sampleRate:48000});audit.contexts.push(this);}};
 if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
 window.AudioWorkletNode=class extends Worklet{constructor(context,name,options){super(context,name,options);record(this,name);}};
 AudioNode.prototype.connect=function(destination,...rest){const from=record(this),to=record(destination);if(destination===this.context.destination){const mute=this.context.createGain();mute.gain.value=0;
   connect.call(this,mute);connect.call(mute,destination);audit.physical.push({source:this,mute});tap(this);audit.edges.push({from:from.id,to:to.id,physical:true});return destination;}
   const result=connect.call(this,destination,...rest);audit.edges.push({from:from.id,to:to.id});tap(this);return result;};
 AudioNode.prototype.disconnect=function(destination,...rest){const from=records.get(this),to=destination&&records.get(destination);if(from)audit.edges=audit.edges.filter(edge=>edge.from!==from.id||(destination&&edge.to!==to?.id));
   const value=arguments.length?disconnect.call(this,destination,...rest):disconnect.call(this);if(from?.tap){try{connect.call(this,from.tap);}catch{}}return value;};
 MessagePort.prototype.postMessage=function(data,...rest){if(data?.method||data?.type==='chip-inspector')audit.commands.push({time:performance.now(),...structuredClone(data)});return post.call(this,data,...rest);};
 const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{const request=open(...args);request.addEventListener('success',()=>audit.databases.push(request.result));return request;};
 audit.snapshot=()=>new Promise((resolve,reject)=>{const db=audit.databases.findLast(value=>value.name==='tetorica-scsp-synth-files');if(!db){resolve(null);return;}try{const request=db.transaction('projects','readonly').objectStore('projects').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}catch(error){reject(error);}});
 audit.levels=()=>audit.nodes.filter(value=>value.tap).map(value=>{const samples=new Float32Array(value.tap.fftSize);value.tap.getFloatTimeDomainData(samples);let peak=0,square=0;for(const sample of samples){if(!Number.isFinite(sample))throw Error('Non-finite native PCM');peak=Math.max(peak,Math.abs(sample));square+=sample*sample;}
   return{id:value.id,name:value.name,gain:value.node.gain?.value??null,peak,rms:Math.sqrt(square/samples.length),edges:audit.edges.filter(edge=>edge.from===value.id).map(edge=>edge.to)};});
 audit.graph=()=>({contexts:audit.contexts.length,rates:audit.contexts.map(value=>value.sampleRate),routes:audit.physical.length,
   physicalOutputMuted:audit.physical.every(value=>value.mute.gain.value===0),nodes:audit.nodes.map(value=>({id:value.id,name:value.name,gain:value.node.gain?.value??null})),edges:audit.edges.slice(),finalMasterId:records.get(audit.physical.at(-1)?.source)?.id});
 audit.request=command=>new Promise((resolve,reject)=>{const node=audit.nodes.findLast(value=>value.name==='tetorica-scsp-synth')?.node;if(!node){reject(Error('SCSP engine missing'));return;}
   const id='output-read-'+ ++audit.sequence,timer=setTimeout(()=>{node.port.removeEventListener('message',receive);reject(Error('Read timed out'));},5000);
   function receive({data}){if(data?.id!==id)return;clearTimeout(timer);node.port.removeEventListener('message',receive);data.error?reject(Error(data.error)):resolve(data.value);}
   node.port.addEventListener('message',receive);node.port.start();node.port.postMessage({...command,id});});
 audit.inspect=()=>audit.request({type:'chip-inspector',action:'read'});
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label,timeout=20000){const deadline=Date.now()+timeout;while(Date.now()<deadline){const value=await read();if(value)return value;await wait(25);}throw Error('Timed out: '+label);}
const read=(page,key)=>page.evaluate(key=>{const value=__scspOutputAudit[key];return typeof value==='function'?value():structuredClone(value);},key);
const inspect=page=>read(page,'inspect'),snapshot=page=>read(page,'snapshot');
const control=(page,name)=>page.locator('#voice [data-chip-control="scsp-'+name+'"]');
const near=(actual,expected,tolerance=.025)=>assert(Math.abs(actual-expected)<=Math.max(.00001,Math.abs(expected)*tolerance),`${actual} should be near ${expected}`);
async function menu(page,selector){if(!await page.locator('#synthMenu').evaluate(node=>node.open))await page.locator('#synthMenuButton').click();await page.locator(selector).click();}
async function setMaster(page,value){await page.locator('#volume').evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));},value);await wait(230);assert.equal(await page.locator('#volumeValue').textContent(),Math.round(value*100)+'%');}
function routeState(graph,levels){const byId=id=>levels.find(value=>value.id===id),master=byId(graph.finalMasterId),comp=levels.find(value=>value.gain===8),main=levels.find(value=>value.name==='tetorica-scsp-synth');assert(master&&comp&&main,'Master, compensation and native Synth are observed');
 const inputs=levels.filter(value=>value.edges.includes(comp.id)),song=inputs.find(value=>Math.abs(value.gain-.125)<1e-6),fade=inputs.find(value=>Math.abs(value.gain-1)<1e-6),balance=levels.find(value=>Math.abs(value.gain-.125)<1e-6&&value.id!==song?.id);
 assert(song&&fade&&balance);assert(comp.edges.includes(master.id));return{master,comp,main,song,fade,balance};}
async function measure(page,label,{source='main',fxGain=1,master=1}={}){
 let result;await until(async()=>{const graph=await read(page,'graph'),levels=await read(page,'levels'),route=routeState(graph,levels),signal=source==='song'?route.song.rms/.125:route.main.rms;
  const expected=signal*master*fxGain;if(signal<.005)return false;if(master===0){if(route.master.peak>1e-7)return false;}else if(Math.abs(route.master.rms-expected)>expected*.04)return false;
  result={label,source,fxGain,master,expectedFinalRms:expected,actualFinalRms:route.master.rms,finalPeak:route.master.peak,nativeEquivalentRms:signal,finalToNativeRatio:route.master.rms/signal,
   balanceToNativeRatio:source==='main'?route.balance.rms/route.main.rms:null,compensationGain:route.comp.gain,graph,levels};return true;},label+' stable actual gain');
 const route=routeState(result.graph,result.levels);if(source==='main')near(route.balance.rms/route.main.rms,.125);if(master)near(result.finalToNativeRatio,master*fxGain,.04);
 assert(result.graph.physicalOutputMuted);assert.equal(result.graph.contexts,1);assert.equal(result.graph.routes,1);assert.deepEqual(result.graph.rates,[48000]);return result;
}
async function silence(page){await until(async()=>{const graph=await read(page,'graph');if(!graph.contexts)return true;const level=(await read(page,'levels')).find(value=>value.id===graph.finalMasterId);return level?.peak<1e-7;},'final Master silence');}
async function source(page,text,{run=true}={}){if(await page.locator('#scspFilesPanel').isHidden())await page.locator('#scspFilesToggle').click();await page.locator('#scspFilesTree button[data-file-path="/index.js"]').click();await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});await page.locator('#synthCodeEditor').fill(text);if(run){await page.locator('#synthCodeRunButton').click();await until(async()=>{assert.equal(await page.locator('#synthCodeError').textContent(),'');return(await inspect(page)).codeActive;},'Code running');}}
const HOLD=`const scsp=await useSoundChip('scsp');await scsp.noteOn(CH1,'A4');log('level-held');`;
const HALF=HOLD+`\nliveFx('half',{process(input,output){for(let c=0;c<output.length;c++)for(let n=0;n<output[c].length;n++)output[c][n]=(input[c]?.[n]??0)*.5;}});`;
async function stopCode(page){await page.locator('#synthCodeStopButton').click();await until(async()=>!(await inspect(page)).codeActive,'Code stopped');await silence(page);}
async function addFile(page,name,text){if(await page.locator('#scspFilesPanel').isHidden())await page.locator('#scspFilesToggle').click();await page.locator('#scspFilesInput').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(text)});await until(()=>page.locator('#scspFilesTree [data-file-path="/'+name+'"]').count(),'imported '+name);}
async function openNew(page){await menu(page,'#scspProjectNewButton');await page.locator('#scspNewCassetteDialog').waitFor({state:'visible'});assert(await page.locator('#scspNewCassetteCancel').evaluate(node=>node===document.activeElement));assert(!await page.locator('#synthMenu').evaluate(node=>node.open));}
async function newDone(page){await page.locator('#scspNewCassetteDialog').waitFor({state:'hidden'});await until(()=>page.locator('#scspFilesStatus').textContent().then(value=>value.startsWith('New SCSP Cassette created.')),'new cassette saved');await until(()=>page.locator('#scspFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files unlocked');await silence(page);}
async function loadSsf(page,bytes){const pending=page.waitForEvent('filechooser');await menu(page,'#loadSsf');await(await pending).setFiles({name:'level-original.ssf',mimeType:'application/octet-stream',buffer:Buffer.from(bytes)});await until(()=>page.locator('#scspSongPlay').isEnabled(),'SSF loaded');}
async function exportCassette(page){const pending=page.waitForEvent('download');await menu(page,'#scspProjectExportButton');const download=await pending;return{bytes:await fs.readFile(await download.path()),name:download.suggestedFilename()};}
async function screenshot(page,engine,label,images){await fs.mkdir(config.screenshots,{recursive:true});const file=path.join(config.screenshots,engine+'-'+label+'.png');await page.screenshot({path:file,fullPage:false});images[label]={file,sha256:sha(await fs.readFile(file))};}
async function check(browser,engine,origin,fixture,loadCassette){
 const context=await browser.newContext({viewport:{width:1400,height:1050},acceptDownloads:true,serviceWorkers:'block'}),page=await context.newPage();await context.addInitScript(installSilentAudit);page.setDefaultTimeout(20000);
 const errors=[],missing=[],external=[],blockedMonaco=[],checks=[],measurements={},images={};let stage='cold menu';
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();(/monaco|jsdelivr/.test(url.href)?blockedMonaco:external).push(url.href);return route.abort();});
 page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
 const step=label=>{stage=label;console.log('CHECK '+engine+': '+label);};
 try{
  await page.goto(origin+config.entry);await until(()=>page.locator('#scspFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'Files ready');assert.equal((await read(page,'graph')).contexts,0);
  await menu(page,'#scspProjectNewButton');assert(await page.locator('#scspNewCassetteDialog').isVisible());await page.locator('#scspNewCassetteCancel').click();assert.equal((await read(page,'graph')).contexts,0);
  await page.locator('#synthMenuButton').click();assert.equal(await page.locator('#scspMenuProjectNew #scspProjectNewButton').textContent(),'Cassette…');assert.equal(await page.locator('#scspMenuProjectImport #scspProjectImportButton').textContent(),'Cassette…');
  assert(await page.locator('#synthMenuPanel').getByRole('heading',{name:'New',exact:true}).isVisible());assert(await page.locator('#synthMenuPanel').getByRole('heading',{name:'Import',exact:true}).isVisible());await page.locator('#synthMenuButton').click();
  checks.push('New → Cassette is separate from existing Import → Cassette; cold open/cancel creates no audio');

  step('keyboard gain once at Master zero/default/100/max');
  await page.locator('#synthInputKeyboardTab').click();const key=await page.locator('#keyboard .key').filter({hasText:/\bC4\b/}).first().getAttribute('data-key');assert(key);
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down(key);await until(async()=> (await read(page,'graph')).nodes.some(value=>value.name==='tetorica-scsp-synth'),'keyboard audio initialized');await until(async()=> (await inspect(page)).voiceGroups.some(group=>group.held),'keyboard held');
  measurements.keyboard=[];for(const master of[.6,0,1,3.8]){await setMaster(page,master);measurements.keyboard.push(await measure(page,'Keyboard Master '+master,{master}));}
  near(measurements.keyboard.find(value=>value.master===1).finalPeak,.14892578125,.02);await page.keyboard.up(key);await silence(page);
  checks.push('Real keyboard native → .125 input → exactly one 8× compensation → Master gives expected PCM at 0%,60%,100%,380%; final monitor sees the compensated output');

  step('Code dry and actual liveFx preserve .125 input and shared compensation');
  await setMaster(page,1);await source(page,HOLD);measurements.codeDry=await measure(page,'Code dry Master100',{master:1});await stopCode(page);
  await source(page,HALF);measurements.codeFx=await measure(page,'Code half-gain liveFx Master100',{master:1,fxGain:.5});
  near(measurements.codeFx.balanceToNativeRatio,.125);near(measurements.codeFx.finalToNativeRatio,.5,.04);await stopCode(page);
  checks.push('Documented Code and real liveFx half-gain retain the original .125 FX input and receive compensation exactly once after FX');

  step('SSF playback and paused audition use one shared final gain');
  await addFile(page,'keep-before-new.txt','Keep before New Cassette\n');await control(page,'root').fill('500');await control(page,'root').dispatchEvent('change');
  await loadSsf(page,fixture.standalone);await page.locator('#scspSongPlay').click();await until(()=>page.locator('#scspSsfLive').getAttribute('data-active').then(value=>value==='true'),'SSF live');
  await page.locator('[data-scsp-channel="0"]').click();measurements.ssf=[];for(const master of[.6,0,1,3.8]){await setMaster(page,master);measurements.ssf.push(await measure(page,'SSF Master '+master,{source:'song',master}));}
  await page.locator('#scspSongPause').click();await until(()=>page.locator('#scspSongPause').textContent().then(value=>value==='Resume'),'SSF paused');await silence(page);await setMaster(page,1);
  await page.locator('#synthInputKeyboardTab').click();await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.down(key);await until(async()=>{const value=await page.evaluate(()=>__scspOutputAudit.request({method:'readAudition',args:[]}));return value.voiceGroups.some(group=>group.held);},'paused audition held');
  measurements.audition=await measure(page,'Paused SSF audition Master100',{master:1});await page.keyboard.up(key);await silence(page);
  checks.push('Actual original 68000 SSF playback obeys all four Master settings through songInput; paused-keyboard audition uses the same single compensation');

  step('New Cassette cancellation preserves playing SSF, files, patch and draft');
  await page.locator('#scspSongPause').click();await until(()=>page.locator('#scspSongPause').textContent().then(value=>value==='Pause'),'SSF resumed');
  const beforeSong=await snapshot(page),songPosition=Number(await page.locator('#scspSongSeek').inputValue());await openNew(page);
  await page.locator('#scspNewCassetteCancel').click();assert.equal((await snapshot(page)).workspaceId,beforeSong.workspaceId);assert.equal(await page.locator('#scspSongPause').textContent(),'Pause');
  await until(()=>page.locator('#scspSongSeek').inputValue().then(value=>Number(value)>songPosition),'song progresses after Cancel');
  await openNew(page);await page.keyboard.press('Escape');assert.equal((await snapshot(page)).workspaceId,beforeSong.workspaceId);assert.equal(await page.locator('#scspSongPause').textContent(),'Pause');
  await page.locator('#scspSongStop').click();await silence(page);await page.locator('[data-scsp-channel="auto"]').click();assert.equal(await control(page,'root').inputValue(),'500');assert(await page.locator('[data-chip-action="scsp-apply"]').isEnabled());
  await page.locator('#scspSongPlay').click();await until(()=>page.locator('#scspSongPause').textContent().then(value=>value==='Pause'),'song playing before New success');
  await openNew(page);for(const width of[1400,390]){await page.setViewportSize({width,height:1050});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   assert(await page.locator('#scspNewCassetteDialog').evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));await screenshot(page,engine,'new-dialog-'+width,images);}
  await page.setViewportSize({width:1400,height:1050});await page.locator('#scspNewCassetteCreate').click();await newDone(page);
  const firstNew=await snapshot(page);assert.notEqual(firstNew.workspaceId,beforeSong.workspaceId);assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');
  assert(!(await inspect(page)).codeActive);assert(!/Playing|Paused/.test(await page.locator('#scspSongStatus').textContent()));
  assert.equal(await page.locator('#scspFilesTree [data-file-path="/keep-before-new.txt"]').count(),0);assert.equal(await control(page,'totalLevel').inputValue(),'12');
  near(Number(await control(page,'root').inputValue()),44100/64);assert(await page.locator('[data-chip-action="scsp-apply"]').isDisabled(),'fresh project clears the old unapplied draft');
  checks.push('Cancel/Escape preserve the playing SSF, workspace, files and unapplied waveform tuning; Create without export stops transport and commits a fresh local Cassette without autoplay');

  step('running Code cancel and Export current & create preserve the old Cassette');
  await addFile(page,'preserved-notes.txt','Original user text kept by exported Cassette\n');await control(page,'totalLevel').fill('22');await control(page,'totalLevel').dispatchEvent('change');
  const userSource=HOLD+'\nawait scsp.setMix(0,{totalLevel:30});\n// unsaved editor marker: preserved-before-new\n';await source(page,userSource);await until(async()=> (await snapshot(page))?.files?.some?.(file=>file.path==='/preserved-notes.txt')??true,'custom project persisted');
  await wait(180);const running=await inspect(page),beforeCode=await snapshot(page),draftText=userSource+'// latest editor draft\n';await page.locator('#synthCodeEditor').fill(draftText);await wait(180);
  await openNew(page);await page.locator('#scspNewCassetteCancel').click();assert.equal((await inspect(page)).codeSession,running.codeSession);assert((await inspect(page)).codeActive);assert.equal(await page.locator('#synthCodeEditor').inputValue(),draftText);assert.equal((await snapshot(page)).workspaceId,beforeCode.workspaceId);
  await openNew(page);await page.keyboard.press('Escape');assert((await inspect(page)).codeActive);assert.equal(await page.locator('#synthCodeEditor').inputValue(),draftText);
  const oldPatch=await page.evaluate(()=>__scspOutputAudit.request({method:'exportPatch',args:[]})),pending=page.waitForEvent('download');await openNew(page);await page.locator('#scspNewCassetteExport').click();
  const download=await pending,exported=await fs.readFile(await download.path());assert.match(download.suggestedFilename(),/\.cassette\.zip$/);await newDone(page);
  const cassette=await loadCassette(exported),decoder=new TextDecoder();assert.equal(decoder.decode(cassette.files.get('preserved-notes.txt')),'Original user text kept by exported Cassette\n');assert.equal(decoder.decode(cassette.files.get('index.js')),draftText);
  const manifest=JSON.parse(decoder.decode(cassette.files.get('scsp-synth.project.json')));assert.equal(manifest.settings.operators.carrier.voice.totalLevel,oldPatch.operators.carrier.voice.totalLevel);assert.equal(manifest.settings.operators.carrier.voice.totalLevel,30);
  const secondNew=await snapshot(page);assert.notEqual(secondNew.workspaceId,beforeCode.workspaceId);assert(!(await inspect(page)).codeActive);assert.equal(await page.locator('#synthInputSection').getAttribute('data-input-mode'),'keyboard');
  await page.locator('#synthInputCodeTab').click();const starter=await page.locator('#synthCodeEditor').inputValue();assert.match(starter,/const scsp = await useSoundChip\('scsp'\)/);assert.match(starter,/liveLoop\('melody'/);assert(!starter.includes('latest editor draft'));
  const paths=await page.locator('#scspFilesTree [data-file-path]').evaluateAll(nodes=>nodes.map(node=>node.dataset.filePath));for(const name of['cycle2.js','dsp-iir-motion.js','self-feedback.js','self-feedback-6op.js','parallel-self-feedback.js'])assert(paths.some(value=>value.endsWith('/'+name)),name+' fresh example');
  assert.equal(await page.locator('#scspFilesTree [data-file-path="/preserved-notes.txt"]').count(),0);assert.equal(await control(page,'totalLevel').inputValue(),'12');await silence(page);
  measurements.oldCassette={bytes:exported.length,sha256:sha(exported),filename:download.suggestedFilename(),files:[...cassette.files.keys()],workspaceBefore:beforeCode.workspaceId,workspaceAfter:secondNew.workspaceId};
  await fs.mkdir(path.dirname(config.out),{recursive:true});await fs.writeFile(path.join(path.dirname(config.out),engine+'-preserved.cassette.zip'),exported);
  checks.push('Running-Code Cancel/Escape preserve session and latest editor text; Export current & create downloads the old files/source/sound before resetting to the actual host starter plus five examples, persisted and stopped');

  step('existing Import restores exported content without autoplay, invalid import preserves it');
  const chooser=page.waitForEvent('filechooser');await menu(page,'#scspProjectImportButton');await(await chooser).setFiles({name:'preserved.cassette.zip',mimeType:'application/zip',buffer:exported});
  await until(()=>page.locator('#scspFilesTree [data-file-path="/preserved-notes.txt"]').count(),'old Cassette restored by existing Import');await until(()=>page.locator('#scspFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'import done');
  await page.locator('#scspFilesTree button[data-file-path="/index.js"]').click();await page.locator('#synthInputCodeTab').click();assert.equal(await page.locator('#synthCodeEditor').inputValue(),draftText);assert.equal(await control(page,'totalLevel').inputValue(),'30');assert(!(await inspect(page)).codeActive);await silence(page);
  const imported=await snapshot(page),badChooser=page.waitForEvent('filechooser');await menu(page,'#scspProjectImportButton');await(await badChooser).setFiles({name:'invalid.cassette.zip',mimeType:'application/zip',buffer:Buffer.from('invalid archive')});
  await until(()=>page.locator('#scspFilesStatus').textContent().then(value=>/zip|archive|cassette|invalid/i.test(value)),'invalid Import error');await wait(150);
  assert.equal((await snapshot(page)).workspaceId,imported.workspaceId);assert.equal(await page.locator('#synthCodeEditor').inputValue(),draftText);assert.equal(await control(page,'totalLevel').inputValue(),'30');assert(!(await inspect(page)).codeActive);await silence(page);
  await page.reload();await until(()=>page.locator('#scspFilesPanel').getAttribute('aria-busy').then(value=>value==='false'),'restored after reload');assert.equal((await read(page,'graph')).contexts,0);assert.equal((await snapshot(page)).workspaceId,imported.workspaceId);
  await page.locator('#synthInputCodeTab').click();await page.locator('#scspFilesTree button[data-file-path="/index.js"]').click();assert.equal(await page.locator('#synthCodeEditor').inputValue(),draftText);assert(!/Running|Playing/.test(await page.locator('#synthCodeState').textContent()));
  checks.push('Existing Import restores exported Cassette source/PCM/mix without execution; invalid Import preserves workspace; reload restores the latest persisted Cassette without creating audio');
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  return{browser:engine,passed:true,checks,measurements,images,errors,missing,external,expectedBlockedMonaco:blockedMonaco,physicalOutputMuted:true,listeningPerformed:false,
   auditMethod:'Passive WebAudio node/connection/PCM taps and read-only inspector/IndexedDB snapshots; real UI and documented Code API, no production source injection or helper replacement'};
 }catch(error){await screenshot(page,engine,'failure',images).catch(()=>{});error.receipt={browser:engine,passed:false,stage,error:error.stack,checks,measurements,images,errors,missing,external,expectedBlockedMonaco:blockedMonaco,
  status:await page.locator('#status').textContent().catch(()=>null),filesStatus:await page.locator('#scspFilesStatus').textContent().catch(()=>null),codeError:await page.locator('#synthCodeError').textContent().catch(()=>null),graph:await read(page,'graph').catch(()=>null),levels:await read(page,'levels').catch(()=>null)};throw error;
 }finally{await context.close();}
}
(async()=>{const{createScspSsfPlaybackFixture,ssfFromProgram}=await import(pathToFileURL(path.join(repository,'test/helpers/scsp_ssf_fixture.mjs'))),{loadPlaygroundCassette}=await import(pathToFileURL(path.join(repository,'docs/playground/playground_cassette.js')));const fixture=createScspSsfPlaybackFixture();fixture.standalone=ssfFromProgram(fixture.image,0,'title=Original output level fixture\nlength=0:45\nfade=0:00.25\n');let failure=null;
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin='http://127.0.0.1:'+server.address().port;
  for(const engine of engines){const browser=await{chromium,webkit}[engine].launch({headless:true,...engine==='chromium'?{args:['--mute-audio']}: {}});try{results.push(await check(browser,engine,origin,fixture,loadPlaygroundCassette));}catch(error){results.push(error.receipt??{browser:engine,passed:false,error:error.stack});throw error;}finally{await browser.close();}}assert.deepEqual(sourceErrors,[]);
 }catch(error){failure=error;}finally{server.closeAllConnections?.();if(server.listening)await new Promise(resolve=>server.close(resolve));}
 const receipt={schemaVersion:1,passed:!failure,elapsedSeconds:(Date.now()-started)/1000,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,
  checker:{file:path.relative(repository,__filename),sha256:sha(await fs.readFile(__filename))},servedAssets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),sourceErrors,results,...failure?{error:failure.stack}:{}};
 await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(receipt,null,2)+'\n');if(failure)throw failure;console.log('PASS receipt '+config.out);
})().catch(error=>{console.error(error);process.exitCode=1;});
