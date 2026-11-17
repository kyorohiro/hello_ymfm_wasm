// SPDX-License-Identifier: BSD-3-Clause
// Verify live Synth DSP bus/return controls and readable setup export with permanently muted physical output.
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium, webkit} = require('playwright');

const repository = path.resolve(__dirname, '..');
const config = {
  root: path.join(repository, 'docs'), entry: '/synth-scsp/index.html',
  engines: 'chromium,webkit', out: path.join(os.tmpdir(), 'scsp-synth-dsp-routing-browser.json'),
};
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  const match = /^--(root|entry|engines|out)(?:=(.+))?$/.exec(args[index]);
  assert(match, 'Unknown argument ' + args[index]);
  config[match[1]] = match[2] ?? args[++index];
  assert(config[match[1]], 'Missing value for ' + match[1]);
}
config.root = path.resolve(config.root);
assert(config.entry.startsWith('/') && !/[?#]/.test(config.entry));
const engines = config.engines.split(',');
assert(engines.length && engines.every(name => ['chromium', 'webkit'].includes(name)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.md': 'text/plain', '.scspasm': 'text/plain',
};
const served = new Map();
const server = http.createServer(async (request, response) => {
  try {
    let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (relative === '/favicon.ico') {response.writeHead(204).end(); return;}
    if (relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(config.root, '.' + relative);
    assert(file.startsWith(config.root + path.sep), 'Request stays inside the isolated static site');
    const bytes = await fs.readFile(file);
    const asset=path.relative(config.root,file).split(path.sep).join('/'),record={bytes:bytes.length,sha256:sha(bytes)};
    assert(!served.has(asset)||served.get(asset).sha256===record.sha256,'Source changed during verification: '+asset);
    served.set(asset, record);
    response.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'}).end(bytes);
  } catch {response.writeHead(404).end();}
});

// Install before application modules. The real signal feeds analysers followed
// by gains fixed at zero; no signal ever connects directly to a destination.
function installSilentAudit(rate) {
  const Context = window.AudioContext ?? window.webkitAudioContext;
  const Worklet = window.AudioWorkletNode;
  const connect = AudioNode.prototype.connect;
  const post = MessagePort.prototype.postMessage;
  const audit = window.__scspDspSaveAudit = {
    contexts: [], nodes: [], meters: [], commands: [], clipboard: [],
    clipboardMode: 'success', sequence: 0, holdNextApply: false, heldApply: null,
  };
  window.AudioContext = class extends Context {
    constructor(options={}) {super({...options,sampleRate:rate}); audit.contexts.push(this);}
  };
  if (window.webkitAudioContext) window.webkitAudioContext = window.AudioContext;
  window.AudioWorkletNode = class extends Worklet {
    constructor(context, name, options) {
      super(context, name, options); audit.nodes.push({name, node: this});
    }
  };
  AudioNode.prototype.connect = function(destination, ...rest) {
    if (destination !== this.context.destination) return connect.call(this, destination, ...rest);
    const split = this.context.createChannelSplitter(2), left = this.context.createAnalyser(), right = this.context.createAnalyser(), mute = this.context.createGain();
    left.fftSize = right.fftSize = 2048; mute.gain.value = 0;
    connect.call(this, split); connect.call(split, left, 0); connect.call(split, right, 1);
    connect.call(left, mute); connect.call(right, mute); connect.call(mute, destination);
    audit.meters.push({left, right, mute});
    return destination;
  };
  MessagePort.prototype.postMessage = function(data, ...rest) {
    if (data?.method || data?.type === 'chip-inspector') audit.commands.push(structuredClone(data));
    const method = data?.method === 'code' ? data.args?.[1] : data?.method;
    if (data?.method === 'readDspSetup' && audit.holdNextSetupSnapshot) {
      audit.holdNextSetupSnapshot = false;
      audit.heldSetup = {port:this, data:structuredClone(data), rest};
      return;
    }
    if (data?.method === 'code' && method === audit.holdNextCodeMethod) {
      audit.holdNextCodeMethod = null;
      audit.heldApply = {port: this, id: data.id, data: structuredClone(data), rest};
      return;
    }
    if (data?.method === 'code' && method === audit.blockReadsAfterCodeMethod) {
      audit.blockReadsAfterCodeMethod = null;
      audit.holdAuthoring = true;
      audit.bridgeAck = null;
      const id = data.id;
      this.addEventListener('message', function receive({data: reply}) {
        if (reply?.id !== id) return;
        this.removeEventListener('message', receive);
        audit.bridgeAck = structuredClone(reply);
      });
    }
    if (data?.method === 'readAuthoring' && audit.holdAuthoring) {
      audit.heldReads = (audit.heldReads ?? 0) + 1;
      return;
    }
    return post.call(this, data, ...rest);
  };
  audit.releaseHeldSetup = () => {
    if (!audit.heldSetup) throw Error('No pending DSP snapshot');
    const {port, data, rest} = audit.heldSetup; audit.heldSetup = null;
    post.call(port, data, ...rest);
  };
  audit.rejectHeldApply = () => {
    if (!audit.heldApply) throw Error('No pending DSP Apply transport request');
    const {port, id} = audit.heldApply; audit.heldApply = null;
    port.dispatchEvent(new MessageEvent('message', {data: {id, error: 'Injected DSP Apply transport rejection'}}));
  };
  audit.releaseHeldApply = () => {
    if (!audit.heldApply) throw Error('No pending DSP Apply transport request');
    const {port, data, rest} = audit.heldApply; audit.heldApply = null;
    post.call(port, data, ...rest);
  };
  // Both paths are test doubles, never operating-system clipboard calls.
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
    async writeText(text) {
      audit.clipboard.push({method: 'clipboard', text: String(text)});
      if (audit.clipboardMode !== 'success') throw Error('Clipboard test denial');
    },
  }});
  Object.defineProperty(document, 'execCommand', {configurable: true, value(command) {
    const active = document.activeElement;
    const text = typeof active?.value === 'string' ? active.value : String(window.getSelection());
    const result = command === 'copy' && audit.clipboardMode === 'fallback';
    audit.clipboard.push({method: 'execCommand', command, text, result}); return result;
  }});
  audit.level = () => {
    const channel = key => {
      let peak=0,sum=0,square=0,count=0;
      for(const meter of audit.meters) {
        const analyser=meter[key];if(analyser.context.state==='closed')continue;
        const values=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(values);
        for(const value of values){if(!Number.isFinite(value))throw Error('Non-finite PCM');peak=Math.max(peak,Math.abs(value));sum+=value;square+=value*value;count++;}
      }
      const n=Math.max(1,count);return {peak,rms:Math.sqrt(square/n),acRms:Math.sqrt(Math.max(0,square/n-(sum/n)**2))};
    };
    const left=channel('left'),right=channel('right');return {left,right,peak:Math.max(left.peak,right.peak)};
  };
  audit.graph = () => ({contexts: audit.contexts.length, contextStates: audit.contexts.map(item => item.state),
    nodes: audit.nodes.map(item => item.name), destinationRoutes: audit.meters.length,
    physicalOutputMuted: audit.meters.every(item => item.mute.gain.value === 0)});
  audit.request = command => new Promise((resolve, reject) => {
    const node = audit.nodes.findLast(item => item.name === 'tetorica-scsp-synth')?.node;
    if (!node) {reject(Error('SCSP primary Synth endpoint is unavailable')); return;}
    const id = 'dsp-save-audit-' + ++audit.sequence;
    const timer = setTimeout(() => {
      node.port.removeEventListener('message', receive); reject(Error('SCSP response exceeded five seconds'));
    }, 5000);
    function receive({data}) {
      if (data?.id !== id) return;
      clearTimeout(timer); node.port.removeEventListener('message', receive);
      if (data.error) {const error = Error(data.error); error.name = data.name ?? 'Error'; reject(error);}
      else resolve(data.value);
    }
    node.port.addEventListener('message', receive); node.port.start();
    node.port.postMessage({...command, id});
  });
  audit.inspect = () => audit.request({type: 'chip-inspector', action: 'read'});
}

const request = (page, command) => page.evaluate(command => __scspDspSaveAudit.request(command), command);
const inspect = page => page.evaluate(() => __scspDspSaveAudit.inspect());
const level = page => page.evaluate(() => __scspDspSaveAudit.level());
async function until(read, description) {
  for(let index=0;index<100;index++) {const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,40));}
  throw Error('Timed out: '+description);
}
const waitState = (page, predicate, description) => until(async()=>{const state=await inspect(page);return predicate(state)?state:false;},description);
async function number(page,id,value) {
  await page.locator('#'+id).evaluate((input,value)=>{input.value=String(value);input.dispatchEvent(new Event('change',{bubbles:true}));},value);
}
async function selectChannel(page,slot) {
  await page.locator(`[data-scsp-channel="${slot??'auto'}"]`).click();
  await page.waitForFunction(value=>document.getElementById('scspChannelTabs').dataset.selected===String(value),slot??'auto');
}
async function exercise(name,rate,origin) {
  const browser=await({chromium,webkit}[name]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();
  const errors=[],missing=[],external=[];
  const imageBase=path.join(path.dirname(path.resolve(config.out)),path.basename(config.out,'.json')+'-'+name+'-'+rate);
  await context.addInitScript(installSilentAudit,rate);
  await context.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort();}return route.continue();});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400)missing.push({url:response.url(),status:response.status()});});
  try {
    await page.goto(origin+config.entry);
    await page.waitForFunction(()=>!document.getElementById('start').disabled&&document.querySelectorAll('[data-scsp-channel]').length===33);
    await page.locator('#scspDspTab').click();
    assert(await page.locator('#scspChannelTabs').isVisible(),'Channel selection remains visible in DSP');
    assert.equal(await page.evaluate(()=>__scspDspSaveAudit.contexts.length),0,'Cold controls do not start audio');
    await selectChannel(page,1);
    await page.locator('#scspDspInput').selectOption('1');
    await until(async()=>await page.locator('#scspDspRouteStatus').textContent().then(text=>text.includes('Edited')),'cold route edit');
    await page.locator('#scspDspRouteDefault').click();
    await until(async()=>await page.locator('#scspDspRouteStatus').textContent().then(text=>text.includes('Inherited')),'cold inherit');
    await page.locator('#start').click();
    await page.waitForFunction(()=>__scspDspSaveAudit.nodes.some(value=>value.name==='tetorica-scsp-synth')&&!document.getElementById('start').disabled);
    await waitState(page,state=>state.dspReturns?.length===2,'audio ready');
    await page.locator('#scspDspProgramExample').selectOption('routing-gain-iir');
    await page.locator('#scspDspProgramCheck').click();
    await page.locator('#scspDspProgramApply').click();
    await page.waitForFunction(()=>document.getElementById('scspDspProgramApplied').textContent.includes('Gain'));
    await page.locator('#effectEnabled').check();
    await number(page,'effectReturn',7);await number(page,'scspDspReturn0Pan',31);
    await number(page,'scspDspReturn1Level',7);await number(page,'scspDspReturn1Pan',15);
    for(const [slot,input] of [[0,0],[1,1]]) {
      await selectChannel(page,slot);
      await page.locator('#scspDspInput').selectOption(String(input));
      await number(page,'scspDspSend',7);
      await waitState(page,state=>state.dspRouting.slots[slot].input===input&&state.dspRouting.slots[slot].level===7,'UI send');
      await request(page,{method:'invokePhysical',args:['setMix',[slot,{totalLevel:12,directLevel:0}]]});
      await request(page,{method:'physicalNoteOn',args:['routing-'+slot,slot,69]});
    }
    const held=await waitState(page,state=>state.slots[0].gate&&state.slots[1].gate&&state.config.effect.enabled&&state.dspReturns[1].pan===15,'two held voices');
    await page.waitForTimeout(220);
    const both=await level(page);assert(both.left.acRms>.00005&&both.right.acRms>.00005,JSON.stringify(both));
    assert(both.left.acRms>both.right.acRms*1.1,'IIR changes the right channel');
    await number(page,'scspDspReturn1Level',0);
    await waitState(page,state=>state.dspReturns[1].level===0,'return1 mute');await page.waitForTimeout(150);
    const leftOnly=await level(page);assert(leftOnly.left.acRms>.00005&&leftOnly.right.peak===0,JSON.stringify(leftOnly));
    await number(page,'scspDspReturn1Level',7);await number(page,'effectReturn',0);
    await waitState(page,state=>state.dspReturns[0].level===0&&state.dspReturns[1].level===7,'return0 mute');await page.waitForTimeout(150);
    const rightOnly=await level(page);assert(rightOnly.right.acRms>.00005&&rightOnly.left.peak===0,JSON.stringify(rightOnly));
    await selectChannel(page,1);await page.locator('#scspDspInput').selectOption('0');
    await waitState(page,state=>state.dspRouting.slots[1].input===0,'live bus move');await page.waitForTimeout(180);
    const disconnected=await level(page);assert(disconnected.right.acRms<1e-7,JSON.stringify(disconnected));
    const moved=await inspect(page);assert(moved.slots[0].gate&&moved.slots[1].gate);assert.equal(moved.ramUsedBytes,held.ramUsedBytes);
    assert.deepEqual(moved.playingSampleIds,held.playingSampleIds);
    await page.locator('#scspDspInput').selectOption('1');await number(page,'effectReturn',7);
    await waitState(page,state=>state.dspRouting.slots[1].input===1&&state.dspReturns[0].level===7,'restore');
    // Exercise the same +/- and horizontal drag controls used throughout Synth.
    await page.getByRole('button',{name:'Decrease scspDspSend',exact:true}).click();
    await waitState(page,state=>state.dspRouting.slots[1].level===6,'send decrement');
    const box=await page.locator('#scspDspSend').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+12,box.y+box.height/2);await page.mouse.up();
    await waitState(page,state=>state.dspRouting.slots[1].level===7,'send drag');
    await page.locator('#scspDspRouting').screenshot({path:imageBase+'-desktop.png'});
    await page.locator('#scspDspSetupSave').click();
    await page.waitForFunction(()=>/saved/i.test(document.getElementById('scspDspProgramStatus').textContent));
    const setup=await request(page,{method:'readDspSetup',args:[]});
    assert.deepEqual(setup.dspReturns,[{level:7,pan:31},{level:7,pan:15}]);
    assert.equal(setup.dspRoutingOverrides.slots[1].input,1);
    await selectChannel(page,null);await page.locator('#scspDspSource').selectOption('0');
    await page.locator('#scspDspInput').selectOption('1');await number(page,'scspDspSend',4);
    await waitState(page,state=>state.dspRouting.sources[0].input===1&&state.dspRouting.sources[0].level===4,'Auto source');
    await page.locator('#scspDspRouteDefault').click();
    await waitState(page,state=>state.dspRoutingOverrides.sources[0]===null,'Auto restore inheritance');
    // Start Code, then change a Return through UI; neither action stops the other.
    await page.locator('#synthInputCodeTab').click();
    const editor=page.locator('#synthCodeEditor');
    await editor.evaluate(input=>{input.value=`const scsp=await useSoundChip('scsp');liveLoop('routing-ui',async()=>{await scsp.noteOn(CH1,'A3');await beat(.5);await scsp.noteOff(CH1);await beat(.25);});`;input.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.locator('#synthCodeRunButton').click();
    await waitState(page,state=>state.codeActive,'Code started');
    await number(page,'scspDspReturn1Pan',0);
    await waitState(page,state=>state.codeActive&&state.dspReturns[1].pan===0,'Code + UI');
    await page.locator('#synthCodeStopButton').click();
    await waitState(page,state=>!state.codeActive,'Code Stop');
    await page.locator('#stop').click();await page.waitForTimeout(180);
    const stopped=await level(page);assert.equal(stopped.peak,0,JSON.stringify(stopped));
    const graph=await page.evaluate(()=>__scspDspSaveAudit.graph());assert(graph.physicalOutputMuted);
    await page.setViewportSize({width:390,height:844});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,'Mobile overflow '+overflow);
    await page.locator('#scspDspRouting').screenshot({path:imageBase+'-mobile.png'});
    assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
    return {browser:name,rate,passed:true,both,leftOnly,rightOnly,disconnected,stopped,graph,mobileOverflow:overflow,screenshots:{desktop:imageBase+'-desktop.png',mobile:imageBase+'-mobile.png'},errors,missing,externalRequestsBlocked:external.length};
  } catch(error) {
    console.error(JSON.stringify({name,rate,errors,missing,status:await page.locator('#status').textContent(),body:(await page.locator('body').innerText()).slice(0,5000)},null,2));throw error;
  } finally {await context.close();await browser.close();}
}
(async()=>{
  await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  try {
    const results=[];for(const name of engines)for(const rate of [44100,48000])results.push(await exercise(name,rate,origin));
    for(const [name,record]of served)assert.equal(sha(await fs.readFile(path.join(config.root,name))),record.sha256,'Source changed '+name);
    const report={passed:true,root:config.root,entry:config.entry,physicalOutputMuted:true,listeningPerformed:false,results,assets:Object.fromEntries(served)};
    await fs.mkdir(path.dirname(path.resolve(config.out)),{recursive:true});await fs.writeFile(config.out,JSON.stringify(report,null,2)+'\n');console.log('SCSP Synth DSP routing browser PASS:',config.out);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});

