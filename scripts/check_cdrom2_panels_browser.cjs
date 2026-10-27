// Read-only CD-ROM2 operator tabs on the real Playground. Worklet messages are
// observed before/after inspection; physical output is independently muted.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'..'),args=process.argv.slice(2),served=new Map();
const selected=args.includes('--chromium')?['chromium']:args.includes('--webkit')?['webkit']:['chromium','webkit'];
const out=args.find(arg=>arg.startsWith('--out='))?.slice(6)??'/private/tmp/cdrom2-panels-browser.json';
const imageDir=args.find(arg=>arg.startsWith('--images='))?.slice(9)??'/private/tmp/cdrom2-panels-visual';
if(args.some(arg=>!['--chromium','--webkit'].includes(arg)&&!arg.startsWith('--out=')&&!arg.startsWith('--images=')))throw Error('Usage: node scripts/check_cdrom2_panels_browser.cjs [--chromium|--webkit] [--out=REPORT.json] [--images=DIRECTORY]');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error('Invalid path');
    let bytes=await fs.readFile(file);const name=path.relative(root,file),hash=sha(bytes);
    if(served.has(name)&&served.get(name).sha256!==hash)throw Error('Source changed during Browser check: '+name);
    served.set(name,{bytes:bytes.length,sha256:hash});
    if(pathname==='/docs/playground/playground.js')bytes=Buffer.from(bytes.toString()+'\nwindow.__cdrom2Panels={runtime,megaDrive,cdrom2AudioPanels,setSource:value=>editorAdapter.setValue(value)};');
    const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.svg':'image/svg+xml','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2'};
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]??'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
  }catch(error){res.writeHead(404).end(error.message);}
});
async function installAudit(page){
  await page.addInitScript(()=>{
    const audit=window.__cdrom2Audit={contexts:[],worklets:[],messages:[],reads:[]};
    const Context=window.AudioContext,Worklet=window.AudioWorkletNode,connect=AudioNode.prototype.connect,gates=new WeakMap();
    window.AudioContext=class extends Context{constructor(...args){super(...args);audit.contexts.push(this);}};
    window.AudioWorkletNode=class extends Worklet{constructor(context,name,...args){super(context,name,...args);audit.worklets.push({name,node:this});const post=this.port.postMessage.bind(this.port);this.port.postMessage=(data,...rest)=>{audit.messages.push({node:name,type:data?.action?.type??data?.type??data?.method??'other'});return post(data,...rest);};}};
    AudioNode.prototype.connect=function(destination,...rest){
      if(destination===this.context.destination){let gate=gates.get(this.context);if(!gate){gate=this.context.createGain();gate.gain.value=0;gates.set(this.context,gate);connect.call(gate,destination);}return connect.call(this,gate,...rest);}
      return connect.call(this,destination,...rest);
    };
  });
}
async function ready(page,url){
  await page.goto(url);await page.waitForFunction(()=>window.__cdrom2Panels&&window.monaco?.editor?.getEditors().length||document.getElementById('status')?.textContent==='Startup failed.');
  assert(await page.evaluate(()=>!!window.__cdrom2Panels),'Playground initializes');await page.locator('#startupNotice').waitFor({state:'hidden'});
  await page.evaluate(()=>{
    const api=window.__cdrom2Panels.runtime,read=api.getSystemAudioState.bind(api);
    api.getSystemAudioState=kind=>{window.__cdrom2Audit.reads.push(kind);return read(kind);};
  });
}
async function snapshot(page,kind){
  return page.evaluate(kind=>{
    const root=document.getElementById(kind+'Panel'),panel=root.querySelector('[data-cdrom2-audio]');
    return {visible:!root.hidden,fields:Object.fromEntries([...root.querySelectorAll('[data-cdrom2-output]')].map(node=>[node.dataset.cdrom2Output,node.textContent])),
      text:root.textContent,buttons:[...root.querySelectorAll('button')].map(node=>node.textContent),
      controls:root.querySelectorAll('input,select,textarea,canvas').length,busy:panel?.getAttribute('aria-busy'),
      keyboardHidden:document.getElementById('keyboardPanel').hidden,
      width:root.clientWidth,scrollWidth:panel?.scrollWidth,panelWidth:panel?.clientWidth};
  },kind);
}
async function choose(page,kind){
  await page.locator('#'+kind+'Tab').click();
  await page.waitForFunction(kind=>{const root=document.getElementById(kind+'Panel');return !root.hidden&&root.querySelector('[data-cdrom2-audio]')?.getAttribute('aria-busy')==='false';},kind);
  return snapshot(page,kind);
}
async function refresh(page,kind){
  await page.locator('#'+kind+'Panel [data-cdrom2-action="refresh"]').click();
  await page.waitForFunction(kind=>document.querySelector('#'+kind+'Panel [data-cdrom2-audio]')?.getAttribute('aria-busy')==='false',kind);
  return snapshot(page,kind);
}
async function check(page,origin,browser,layout){
  await installAudit(page);await ready(page,`${origin}/docs/playground/index.html?mode=pc-engine-cd&no-sw=1`);
  const before=await page.evaluate(()=>({contexts:window.__cdrom2Audit.contexts.length,worklets:window.__cdrom2Audit.worklets.length,
    tabs:['huc6280','msm5205','cdda'].map(kind=>({kind,hidden:document.getElementById(kind+'Tab').hidden,label:document.getElementById(kind+'Tab').textContent}))}));
  assert(before.tabs.every(tab=>!tab.hidden),'all three CD-ROM2 devices visible before Run');
  assert.equal(before.contexts,0,'loading page does not initialize audio');assert.equal(before.worklets,0);
  const idle={};
  for(const kind of ['msm5205','cdda']){
    idle[kind]=await choose(page,kind);assert.equal(idle[kind].fields.state,'Not initialized');assert.equal(idle[kind].keyboardHidden,true);
    assert.equal(idle[kind].controls,0);assert.deepEqual(idle[kind].buttons,['Refresh']);
    await refresh(page,kind);
  }
  const idleAudit=await page.evaluate(()=>({contexts:window.__cdrom2Audit.contexts.length,worklets:window.__cdrom2Audit.worklets.length,messages:window.__cdrom2Audit.messages.length,reads:[...window.__cdrom2Audit.reads]}));
  assert.equal(idleAudit.contexts,0,'inspection never creates AudioContext');assert.equal(idleAudit.worklets,0,'inspection never creates an endpoint');assert.equal(idleAudit.messages,0,'inspection never writes audio commands');
  // Returning to the code editor hides the snapshot; hidden views do not read.
  await page.locator('#codeTab').click();const hiddenReads=await page.evaluate(()=>window.__cdrom2Audit.reads.length);
  await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>window.__cdrom2Audit.reads.length),hiddenReads,'hidden views do not poll');
  await page.evaluate(async()=>{
    const shared=window.__cdrom2Panels,source=await(await fetch('/docs/playground/defaults/pc-engine-cd/index.js')).text();
    shared.setSource(source+"\nconsole.log('__CDROM2_UI_READY__');");document.getElementById('workerExecution').checked=false;
  });
  await page.click('#runButton');await page.waitForFunction(()=>document.getElementById('consoleOutput').textContent.includes('__CDROM2_UI_READY__'));
  const playing={};let index=await page.evaluate(()=>window.__cdrom2Audit.messages.length);
  for(const kind of ['msm5205','cdda']){
    playing[kind]=await choose(page,kind);assert.equal(playing[kind].fields.state,'Playing',kind+' reports actual playback');assert.equal(playing[kind].keyboardHidden,true);
    if(kind==='msm5205'){assert.match(playing[kind].fields.memory,/4,000 \/ 65,536 bytes/);assert.match(playing[kind].fields.rate,/8,000 Hz.*12/);}
    else {assert.match(playing[kind].fields.track,/^1/);assert.match(playing[kind].fields.frames,/352,800/);assert.match(playing[kind].fields.memory,/1,411,200 bytes/);}
    const first=playing[kind].fields[kind==='msm5205'?'position':'frames'];await page.waitForTimeout(130);const next=await refresh(page,kind);
    assert.notEqual(next.fields[kind==='msm5205'?'position':'frames'],first,'manual Refresh advances '+kind+' snapshot');
    assert.equal(next.keyboardHidden,true,'playback snapshots never route Keyboard');
    assert(next.scrollWidth<=next.panelWidth+2,`${layout}/${kind}: snapshot fits panel`);
    const image=path.join(imageDir,`${browser}-${layout}-${kind}.png`);await page.screenshot({path:image,fullPage:false});playing[kind].screenshot=image;
  }
  const inspectionMessages=await page.evaluate(index=>window.__cdrom2Audit.messages.slice(index).filter(message=>['tetorica-msm5205','tetorica-cdda'].includes(message.node)),index);
  assert(inspectionMessages.length>=4,'snapshot reads reach the existing audio endpoints');
  assert(inspectionMessages.every(message=>message.type==='state'),'opening and refreshing sends state reads only');
  const visibleReads=await page.evaluate(()=>window.__cdrom2Audit.reads.length);await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>window.__cdrom2Audit.reads.length),visibleReads,'visible snapshots do not poll');
  // HuC6280 retains the existing instrument audition overlay.
  await page.locator('#huc6280Tab').click();await page.waitForFunction(()=>!document.getElementById('huc6280Panel').hidden);
  const psgKeyboard=await page.evaluate(()=>({hidden:document.getElementById('keyboardPanel').hidden,floating:document.getElementById('keyboardPanel').classList.contains('is-floating-keyboard')}));
  assert.equal(psgKeyboard.hidden,false,'PSG instrument keeps its Keyboard');assert.equal(psgKeyboard.floating,true);
  await choose(page,'cdda');await page.click('#stopButton');await page.waitForFunction(()=>window.__cdrom2Panels.runtime.getState().playback==='stopped');
  const stopped={};for(const kind of ['msm5205','cdda']){await choose(page,kind);stopped[kind]=await refresh(page,kind);assert.equal(stopped[kind].fields.state,'Not initialized','Stop retires '+kind+' source');}
  const finalAudit=await page.evaluate(()=>({contexts:window.__cdrom2Audit.contexts.length,worklets:window.__cdrom2Audit.worklets.map(({name})=>name),reads:window.__cdrom2Audit.reads.length}));
  return {layout,before,idle,idleAudit,playing,inspectionMessages,psgKeyboard,stopped,finalAudit,physicalOutputMuted:true};
}
(async()=>{
  await fs.mkdir(imageDir,{recursive:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,results=[],plain=[];
  try{
    for(const name of selected){
      const browser=await(name==='chromium'?chromium:webkit).launch({headless:true,...(name==='chromium'?{args:['--autoplay-policy=no-user-gesture-required']}: {})});
      try{
        for(const[layout,viewport]of [['desktop',{width:1280,height:900}],['compact',{width:390,height:844}]]){
          const page=await browser.newPage({serviceWorkers:'block',viewport}),errors=[],bad=[];page.setDefaultTimeout(30000);
          page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.status()>=400)bad.push({url:response.url(),status:response.status()});});
          page.on('console',message=>{if(message.type()==='error')console.error(`${name}/${layout}: ${message.text()}`);});
          try{const result=await check(page,origin,name,layout);assert.deepEqual(errors,[]);assert.deepEqual(bad,[]);results.push({browser:name,version:browser.version(),...result});console.log(`PASS ${name}/${layout}: three tabs, no initialization/writes/polling, real snapshots and Keyboard routing`);}
          catch(error){console.error({browser:name,layout,errors,bad,page:await page.evaluate(()=>({status:document.getElementById('status')?.textContent,console:document.getElementById('consoleOutput')?.textContent,audit:{contexts:window.__cdrom2Audit?.contexts.length,reads:window.__cdrom2Audit?.reads,messages:window.__cdrom2Audit?.messages.slice(-20)}})).catch(()=>null)});throw error;}
          finally{await page.close();}
        }
        const page=await browser.newPage({serviceWorkers:'block'});try{
          await installAudit(page);await ready(page,`${origin}/docs/playground/index.html?mode=pc-engine&no-sw=1`);
          const state=await page.evaluate(()=>({msm5205:document.getElementById('msm5205Tab').hidden,cdda:document.getElementById('cddaTab').hidden,huc6280:document.getElementById('huc6280Tab').hidden,contexts:window.__cdrom2Audit.contexts.length}));
          assert.deepEqual(state,{msm5205:true,cdda:true,huc6280:false,contexts:0});plain.push({browser:name,...state});console.log(`PASS ${name}: base PC Engine keeps only its PSG tab`);
        }finally{await page.close();}
      }finally{await browser.close();}
    }
    const report={schemaVersion:1,passed:true,physicalOutputMuted:true,results,plain,sources:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b))),checkerSha256:sha(await fs.readFile(__filename))};
    await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
