// Public SPU import/export menu checks. Every physical destination is muted
// before application code runs; these checks never start audio or execute Code.
// node scripts/check_spu_synth_menu_browser.cjs --root=docs --entry=/synth-spu/index.html
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),http=require('node:http'),path=require('node:path');
const {createHash}=require('node:crypto'),{pathToFileURL}=require('node:url'),{tmpdir}=require('node:os');
const {chromium,webkit}=require('playwright');
const repo=path.resolve(__dirname,'..'),config={root:path.join(repo,'docs'),entry:'/synth-spu/index.html',engines:'chromium,webkit',out:path.join(tmpdir(),'spu-synth-menu-browser.json'),screenshots:path.join(tmpdir(),'spu-synth-menu-browser')};
for(const arg of process.argv.slice(2)){const match=/^--(root|entry|engines|out|screenshots)=(.+)$/.exec(arg);assert(match,'Unknown argument '+arg);config[match[1]]=match[2];}
config.root=path.resolve(config.root);assert(config.entry.startsWith('/')&&!/[?#]/.test(config.entry));
const engines=config.engines.split(',');assert(engines.length&&engines.every(name=>['chromium','webkit'].includes(name)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const served=new Map(),missing=[],external=[],blockedMonaco=[],httpErrors=[],results=[];
let fixtureRoot,emptyFolder,nonPsfFolder;
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
async function until(fn,label,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await wait(25);}throw Error('Timeout: '+label);}
function silentAudit(){
  const Context=window.AudioContext??window.webkitAudioContext,connect=AudioNode.prototype.connect,post=MessagePort.prototype.postMessage;
  const contexts=[],mutes=[],commands=[];
  window.AudioContext=class extends Context{constructor(...args){super(...args);contexts.push(this);}};
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
  AudioNode.prototype.connect=function(destination,...ports){
    if(destination!==this.context.destination)return connect.call(this,destination,...ports);
    const mute=this.context.createGain();mute.gain.value=0;connect.call(this,mute,...ports);connect.call(mute,destination);mutes.push(mute);return destination;
  };
  MessagePort.prototype.postMessage=function(message,...args){if(message?.method)commands.push({method:message.method,args:message.args});return post.call(this,message,...args);};
  window.__spuMenuAudit=()=>({contexts:contexts.length,destinationConnections:mutes.length,muted:mutes.every(node=>node.gain.value===0),commands:commands.slice()});
}
async function menu(page,open=true){
  if(await page.locator('#synthMenu').evaluate(node=>node.open)!==open)await page.locator('#synthMenuButton').click();
  await until(()=>page.locator('#synthMenu').evaluate((node,expected)=>node.open===expected,open),'menu '+open);
  await until(()=>page.locator('#synthMenuButton').getAttribute('aria-expanded').then(value=>value===String(open)),'menu aria state');
}
async function choose(page,selector,expectedInput,files=[],folder=emptyFolder){
  await menu(page,true);const selection=page.waitForEvent('filechooser');await page.locator(selector).click();
  const picker=await selection;assert.equal(await picker.element().getAttribute('id'),expectedInput,'action opens its original input');
  await until(()=>page.locator('#synthMenu').evaluate(node=>!node.open),'action closes menu');
  // Playwright has no chooser-cancel API for webkitdirectory and requires a
  // directory path even for []. Exercise an owned empty folder instead: its
  // empty FileList must retain the current bank without starting audio.
  if(expectedInput==='psfFolderInput'&&Array.isArray(files)&&!files.length)
    await picker.setFiles(folder);
  else await picker.setFiles(files);
  return picker;
}
async function noAudio(page,label){const graph=await page.evaluate(()=>__spuMenuAudit());assert.equal(graph.contexts,0,label+': no AudioContext');assert.equal(graph.destinationConnections,0,label+': no physical connection');assert(graph.muted);assert.equal(graph.commands.length,0,label+': no audio or Stop commands');return graph;}
async function check(browser,name,origin,loadCassette){
  const page=await browser.newPage({viewport:{width:1240,height:1050},acceptDownloads:true,serviceWorkers:'block'});page.setDefaultTimeout(20000);
  const checks=[],layouts=[],errors=[],consoleErrors=[],expectedConsole=[],folder=name==='webkit'?nonPsfFolder:emptyFolder;let stage='startup';
  page.on('pageerror',error=>errors.push(error.stack??error.message));
  page.on('console',message=>{if(message.type()!=='error')return;const text=message.text(),url=message.location().url;if(/cdnjs\.cloudflare\.com/.test(text+' '+url)||/^Failed to load resource/.test(text)&&blockedMonaco.length)expectedConsole.push(text);else consoleErrors.push(text);});
  page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='cdnjs.cloudflare.com'){blockedMonaco.push(url.href);return route.abort();}if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol)){external.push(url.href);return route.abort();}return route.continue();});
  await page.addInitScript(silentAudit);
  const step=label=>{stage=label;checks.push(label);console.log(`CHECK ${name}: ${label}`);};
  try{
    await page.goto(origin+config.entry);await until(()=>page.locator('#spuFileImportButton').isEnabled(),'Files initialized');
    step('One circular header menu exposes import and export before audio and in every settings tab');
    assert.equal(await page.locator('#synthMenuButton').count(),1);assert.equal(await page.locator('#loadVab').count(),1);
    assert.equal(await page.locator('#loadPsf').count(),1);assert.equal(await page.locator('#savePreset').count(),1);
    const shape=await page.locator('#synthMenuButton').evaluate(node=>{const box=node.getBoundingClientRect(),css=getComputedStyle(node);return {width:box.width,height:box.height,radius:css.borderRadius,hasSvg:Boolean(node.querySelector('svg'))};});
    assert(Math.abs(shape.width-shape.height)<=1,'menu control is square');assert(shape.hasSvg,'menu control retains a hamburger icon');assert(/50%|999/.test(shape.radius)||parseFloat(shape.radius)>=shape.width/2,'menu control is circular');
    for(const tab of ['pcm','adsr','fx','audio','bank']){
      await page.locator(`[data-spu-editor-tab="${tab}"]`).click();await menu(page,true);
      for(const id of ['loadPsf','loadPsfFolder','loadVab','loadAudio','loadPreset','savePreset','spuProjectImportButton','spuProjectExportButton']){
        assert(await page.locator('#'+id).isVisible(),tab+': '+id+' remains accessible');
        assert(await page.locator('#'+id).evaluate(node=>Boolean(node.closest('#synthMenuPanel'))),'action lives in the menu');
      }
      await menu(page,false);
    }
    await noAudio(page,'menu navigation');
    step('Escape and outside pointer close the menu without invoking global Stop or creating audio');
    const beforeClose=await page.locator('#audioStatus').textContent();
    await menu(page,true);await page.keyboard.press('Escape');await until(()=>page.locator('#synthMenu').evaluate(node=>!node.open),'Escape closes menu');
    assert.equal(await page.locator('#synthMenuButton').evaluate(node=>node===document.activeElement),true,'Escape returns focus to the menu button');
    await menu(page,true);await page.locator('#synthTitle').click();await until(()=>page.locator('#synthMenu').evaluate(node=>!node.open),'outside click closes menu');
    await wait(50);assert.equal(await page.locator('#audioStatus').textContent(),beforeClose,'closing the menu does not invoke global Stop');
    await noAudio(page,'close menu');
    step('Every import action opens the correct chooser; cancelled files or folders without PSF retain the instrument without audio');
    for(const [id,input]of [['loadPsf','psfFileInput'],['loadPsfFolder','psfFolderInput'],['loadVab','vabFileInput'],['loadAudio','audioFileInput'],['loadPreset','presetFileInput'],['spuProjectImportButton','spuProjectFileInput']]){
      await choose(page,'#'+id,input,[],folder);await noAudio(page,id+(input==='psfFolderInput'?' folder without PSF':' cancellation'));
    }
    step('A public VAB menu selection opens the original sound bank and lists its Tones without audio');
    await choose(page,'#loadVab','vabFileInput',path.join(repo,'docs/playground/samples/spu-import/spu-synth-demo.vab'));
    await until(()=>page.locator('#vabStatus').textContent().then(value=>/programs.*tones.*samples/i.test(value)),'demo VAB is parsed');
    assert.equal(await page.locator('#instrumentTab-bank').getAttribute('aria-selected'),'true');
    assert(await page.locator('#instrumentPanel-bank').isVisible());assert(await page.locator('#vabTone option').count()>0);assert(await page.locator('#loadVabTone').isEnabled());await noAudio(page,'VAB opening');
    step('Import remains available during expanded Code and restores its bank view without running or stopping Code');
    await page.locator('#synthInputCodeTab').click();await page.locator('#synthCodeEditor').waitFor({state:'visible'});const starter=await page.locator('#synthCodeEditor').inputValue();
    await page.locator('#synthCodeExpandButton').click();await until(()=>page.locator('#synthWorkspace').getAttribute('class').then(value=>value.includes('is-code-expanded')),'expanded Code');
    assert(await page.locator('#synthMenuButton').isVisible());await choose(page,'#loadPsfFolder','psfFolderInput',[],folder);
    await until(()=>page.locator('#synthWorkspace').getAttribute('class').then(value=>!value.includes('is-code-expanded')),'import restores Synth view');
    assert.equal(await page.locator('#instrumentTab-bank').getAttribute('aria-selected'),'true');assert(await page.locator('#instrumentPanel-bank').isVisible());assert.equal(await page.locator('#synthCodeEditor').inputValue(),starter);
    assert.equal(await page.locator('#loadVabTone').isEnabled(),true,'folder without PSF keeps the opened bank');await noAudio(page,'expanded folder without PSF');
    step('Project export and import use the header menu and preserve Files without creating an instrument');
    await menu(page,true);const task=page.waitForEvent('download');await page.locator('#spuProjectExportButton').click();const download=await task,chunks=[];
    for await(const chunk of await download.createReadStream())chunks.push(chunk);const bytes=Buffer.concat(chunks),cassette=await loadCassette(bytes);assert(cassette.files.has('index.js'));assert(cassette.files.has('spu-synth.project.json'));
    await until(()=>page.locator('#synthMenu').evaluate(node=>!node.open),'export closes menu');
    await choose(page,'#spuProjectImportButton','spuProjectFileInput',{name:download.suggestedFilename(),mimeType:'application/zip',buffer:bytes});
    await until(()=>page.locator('#spuFilesStatus').textContent().then(value=>/project imported/i.test(value)),'project import finished');await noAudio(page,'project round trip');
    step('Header menu and import controls remain inside the viewport at desktop, Files-narrow and mobile widths');
    for(const width of [1240,780,390]){
      await page.setViewportSize({width,height:1050});if(await page.locator('#spuFilesPanel').isHidden())await page.locator('#spuFilesToggle').click();await menu(page,true);
      const layout=await page.evaluate(()=>{const panel=document.getElementById('synthMenuPanel').getBoundingClientRect(),button=document.getElementById('synthMenuButton').getBoundingClientRect();return {viewport:innerWidth,document:document.documentElement.scrollWidth,panel:{left:panel.left,right:panel.right,top:panel.top,bottom:panel.bottom},button:{left:button.left,right:button.right,top:button.top,bottom:button.bottom}};});
      assert(layout.document<=width+1,'page has no horizontal overflow '+JSON.stringify(layout));assert(layout.panel.left>=-1&&layout.panel.right<=width+1,'menu fits viewport '+JSON.stringify(layout));
      assert(await page.locator('#loadPsfFolder').isVisible());assert(await page.locator('#spuProjectExportButton').isVisible());layouts.push(layout);
      await page.screenshot({path:path.join(config.screenshots,`${name}-spu-menu-${width}.png`),fullPage:true});await menu(page,false);
    }
    await noAudio(page,'finished menu checks');assert.deepEqual(errors,[]);assert.deepEqual(consoleErrors,[]);
    return{browser:name,passed:true,checks,folderFixture:name==='webkit'?'authored README-only folder; native directory cancellation not tested':'owned empty folder; native directory cancellation not tested',menuShape:shape,layouts,graph:await page.evaluate(()=>__spuMenuAudit()),errors,consoleErrors,expectedFallbackConsole:expectedConsole};
  }catch(error){error.receipt={browser:name,stage,checks,errors,consoleErrors,body:await page.locator('body').innerText().catch(()=>''),graph:await page.evaluate(()=>__spuMenuAudit()).catch(()=>null)};throw error;}finally{await page.close();}
}
const server=http.createServer(async(request,response)=>{
  try{const pathname=new URL(request.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){response.writeHead(204).end();return;}const filename=path.resolve(config.root,'.'+decodeURIComponent(pathname));assert(filename.startsWith(config.root+path.sep),'outside root');const bytes=await fs.readFile(filename),relative=path.relative(config.root,filename).split(path.sep).join('/'),metadata={bytes:bytes.length,sha256:hash(bytes)};if(served.has(relative))assert.deepEqual(served.get(relative),metadata,'source changed');served.set(relative,metadata);response.writeHead(200,{'Content-Type':mime[path.extname(filename)]??'application/octet-stream'}).end(bytes);}catch(error){missing.push({url:request.url,error:error.message});response.writeHead(404).end(error.message);}
});
(async()=>{
  await fs.mkdir(config.screenshots,{recursive:true});fixtureRoot=await fs.mkdtemp(path.join(tmpdir(),'spu-menu-folders-'));emptyFolder=path.join(fixtureRoot,'empty');nonPsfFolder=path.join(fixtureRoot,'without-psf');await fs.mkdir(emptyFolder);await fs.mkdir(nonPsfFolder);await fs.writeFile(path.join(nonPsfFolder,'README.txt'),'Authored menu test fixture. This folder contains no PSF files.\n');await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const origin=`http://127.0.0.1:${server.address().port}`;
  try{const {loadPlaygroundCassette}=await import(pathToFileURL(path.join(repo,'docs/playground/playground_cassette.js')).href);for(const name of engines){const browser=await({chromium,webkit})[name].launch({headless:true,...(name==='chromium'?{args:['--mute-audio','--autoplay-policy=no-user-gesture-required']}:{} )});try{results.push(await check(browser,name,origin,loadPlaygroundCassette));}finally{await browser.close();}}
    assert.deepEqual(missing,[]);assert.deepEqual(external,[]);assert.deepEqual(httpErrors,[]);const report={schemaVersion:1,passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,missing,external,httpErrors,expectedBlockedMonaco:blockedMonaco,assets:Object.fromEntries([...served].sort(([a],[b])=>a.localeCompare(b)))};await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('PASS receipt '+config.out);
  }finally{await new Promise(resolve=>server.close(resolve));if(fixtureRoot)await fs.rm(fixtureRoot,{recursive:true,force:true});}
})().catch(error=>{console.error(error.stack??error);if(error.receipt)console.error(JSON.stringify(error.receipt,null,2));process.exitCode=1;});
