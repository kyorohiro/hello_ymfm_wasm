// Run the shipped listening Example unchanged. Web PCM is real; Native IPC alone
// is mocked, so this checks JS routing/cleanup rather than Native sound quality.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {captureWebMix} = require('./native_backend_extra_stability.cjs');
const {extraChipCount} = require('./native_backend_extra_limits.cjs');

const kinds = ['ym2612','ym2203','ym2608','ym2610','ym2151','ym2413','ym3526','ym3812','y8950','ymf262','dx7',
  'segapsg','ay8910','rf5c164','okim6258','gameboy','nes','huc6280','pwm','snes','spc'];
const example = 'examples/genesis/chip-level-comparison.js';
const marker = index => `Chip comparison ${String(index + 1).padStart(2, '0')}/21: ${kinds[index]} ·`;

// The generic lifecycle observer tracks transfers to a logic Worker. Web Audio
// also transfers the other channel end to an AudioWorklet; its close happens in
// that realm, outside the main-page MessagePort.close hook. Record that ownership
// explicitly rather than allowing a fixed number of unexplained local ports.
function observeChipComparisonWorkletTransfers() {
  const ownerByControlPort=new WeakMap(),transfers=new Map(),closed=new WeakSet();
  const Type=window.AudioWorkletNode,post=MessagePort.prototype.postMessage,close=MessagePort.prototype.close;
  if(Type)window.AudioWorkletNode=new Proxy(Type,{construct(Type,args,NewTarget){
    const node=Reflect.construct(Type,args,NewTarget);
    ownerByControlPort.set(node.port,{context:args[0],processor:String(args[1])});return node;
  }});
  MessagePort.prototype.postMessage=function(message,options) {
    const result=post.call(this,message,options),owner=ownerByControlPort.get(this);
    if(owner)for(const port of (Array.isArray(options)?options:options?.transfer)??[])if(port instanceof MessagePort)transfers.set(port,owner);
    return result;
  };
  MessagePort.prototype.close=function(){closed.add(this);return close.call(this);};
  window.__chipComparisonWorkletTransfers=()=>{
    const ports=[...transfers].filter(([port])=>{
      const state=window.__nativeLifecyclePortState(port);
      return !closed.has(port)&&state?.open&&!state.workerOwned;
    }).map(([,owner])=>({processor:owner.processor,contextState:owner.context.state}));
    return {ports,closedContextTransferredPorts:ports.filter(port=>port.contextState==='closed').length};
  };
}

function assertChipComparisonResources(resources,workletTransfers,label) {
  for(const key of ['workersActive','transferredPortsOpen','activeTargetListeners','activePropertyHandlers'])assert.equal(resources[key],0,label+' '+key);
  assert(workletTransfers.ports.every(port=>port.contextState==='closed'),label+' transferred Worklet ports must belong to closed AudioContexts');
  assert.equal(resources.localPortsOpen,workletTransfers.closedContextTransferredPorts,label+' no unowned local port; Worklet-owned endpoints close with their AudioContext');
}

async function runChipComparison({page,native,tracker,artifacts,name,ready,assertNoLiveAudio,until}) {
  const source = await page.evaluate(async example => {
    const response = await fetch(example);
    if (!response.ok) throw Error('Missing chip comparison Example');
    return response.text();
  }, example);
  const report = {schemaVersion:1,browser:name,example:'/' + example,rows:[],
    limits:['Web Audio PCM is rendered by the actual chip cores. Native IPC is mocked; this does not validate Native PCM or a physical output device.',
      'PCM observations check that every source alternates and remains finite. They are not perceived-loudness or physical-dropout measurements.',
      'The Example runs unchanged; only test observers subscribe to Mixer lifetimes and the pre-FX mix bus.']};
  const originalInvoke = native.invoke.bind(native);
  let nativeObservation;
  native.invoke = async (command,args) => {
    const result = await originalInvoke(command,args);
    if (nativeObservation) {
      nativeObservation.peakRack = Math.max(nativeObservation.peakRack, extraChipCount(native));
      const match = /^native_genesis_extra_(.+)_(create|dispose)$/.exec(command);
      if (match) nativeObservation.events.push({kind:match[1] === 'psg' ? 'segapsg' : match[1],operation:match[2],instance:args.instance});
      if (command==='native_genesis_stop') nativeObservation.events.push({operation:'bulk-stop',command,
        session:args.session,acknowledgedSession:result?.session,remainingRack:extraChipCount(native)});
    }
    return result;
  };

  async function arm(execution) {
    nativeObservation = {peakRack:0,events:[]};
    await page.evaluate(({source,execution}) => {
      const t = window.__nativeBackendTest, mixer = t.runtime.megaDrive.mixer;
      t.mixerState.selectPreset('/sys/mixer/default.json');
      // Native starts lazily, so its two Genesis primary strips may not exist
      // until playSource initializes the session. They are not comparison extras.
      const baseline = new Set(['ym2612','segapsg',...mixer.list().filter(entry => entry.connected).map(entry => entry.id)]);
      const seen = new Set();
      const audit = window.__chipComparisonAudit = {created:[],peakConnected:0,connected:[],result:null,
        currentBefore:t.virtualFiles.get('/mixer/current.json')?.data ?? null,
        defaultsBefore:t.virtualFiles.get('/mixer/default.json')?.data ?? null,
        projectBefore:JSON.stringify(mixer.exportState())};
      audit.release = mixer.subscribe(entries => {
        const extra = entries.filter(entry => entry.connected && !baseline.has(entry.id));
        audit.peakConnected = Math.max(audit.peakConnected, extra.length);
        audit.connected = extra.map(entry => entry.id);
        for (const entry of extra) if (!seen.has(entry.id)) {
          seen.add(entry.id);
          audit.created.push({id:entry.id,name:entry.name,volume:entry.volume,pan:entry.pan,
            muted:entry.muted,solo:entry.solo,kindDefault:mixer.getKindDefault(entry.name)});
        }
      });
      document.getElementById('consoleOutput').replaceChildren();
      // playSource awaits the Example's complete top-level sequence. Keep that
      // promise on the page so the test can press Stop while it is still running.
      t.runtime.playSource(source,{execution}).then(() => {audit.result={fulfilled:true};}, error => {
        audit.result={fulfilled:false,name:error?.name,message:error?.message};
      });
    }, {source,execution});
  }
  async function stopAndObserve(label) {
    await page.evaluate(() => window.__nativeBackendTest.runtime.stopWithFade());
    await page.waitForFunction(() => window.__chipComparisonAudit.result !== null);
    await until(() => tracker.stats.pending === 0 && extraChipCount(native) === 0, label + ' Native requests/rack');
    const state = await page.evaluate(() => {
      const t=window.__nativeBackendTest,s=t.runtime.megaDrive,a=window.__chipComparisonAudit;
      a.release();
      return {created:a.created,peakConnected:a.peakConnected,connected:a.connected,result:a.result,
        currentBefore:a.currentBefore,currentAfter:t.virtualFiles.get('/mixer/current.json')?.data ?? null,
        defaultsBefore:a.defaultsBefore,defaultsAfter:t.virtualFiles.get('/mixer/default.json')?.data ?? null,
        projectBefore:a.projectBefore,projectAfter:JSON.stringify(s.mixer.exportState()),
        reserved:s.mixer.reservedIds.size,devices:s.extraDevices?.size ?? null,
        requests:s.acceptedRequests ?? 0,commands:s.acceptedCommands ?? 0,queued:s.pending?.length ?? 0};
    });
    assert.equal(state.peakConnected,1,label + ': no overlapping extra Mixer source');
    assert.deepEqual(state.connected,[],label + ': no connected extra source after Stop');
    assert.equal(state.reserved,0,label + ': no reserved Mixer ID');
    if(state.devices!==null)assert.equal(state.devices,0,label + ': no remaining JS extra device');
    assert.equal(state.requests,0,label + ': no accepted Native request');
    assert.equal(state.commands,0,label + ': no accepted Native command');
    assert.equal(state.queued,0,label + ': no pending Native command');
    assert.equal(state.currentAfter,state.currentBefore,label + ': audition must preserve current.json bytes');
    assert.equal(state.defaultsAfter,state.defaultsBefore,label + ': audition must preserve default.json bytes');
    assert.equal(state.projectAfter,state.projectBefore,label + ': source lifetimes must not author Mixer overrides');
    for (const entry of state.created) {
      assert.equal(entry.volume,entry.kindDefault.volume,label + ': factory volume for '+entry.name);
      assert.equal(entry.pan,entry.kindDefault.pan,label + ': factory pan for '+entry.name);
      assert.equal(entry.muted,false); assert.equal(entry.solo,false);
    }
    return state;
  }
  async function waitForMarker(index) {
    await page.waitForFunction(marker => document.getElementById('consoleOutput').textContent.includes(marker), marker(index), {timeout:20000});
  }
  function assertNativeOrder(observation,expected,label,{allowBulkCleanup=false}={}) {
    assert.equal(observation.peakRack,1,label + ': Native rack contains at most one extra core');
    const active = new Set(), created = [];
    for (const event of observation.events) {
      if(event.operation==='bulk-stop') {
        assert.equal(event.acknowledgedSession,event.session,label + ': bulk Stop acknowledgment belongs to this session');
        assert.equal(event.remainingRack,0,label + ': acknowledged bulk Stop empties the actual Native rack');
        if(active.size) {
          assert(allowBulkCleanup,label + ': a normal completed tone must individually dispose its core');
          assert.equal(active.size,1,label + ': bulk Stop retires only the interrupted current core');
          active.clear();
        }
        continue;
      }
      const key=event.kind+':'+event.instance;
      if (event.operation==='create') {assert.equal(active.size,0,label + ': previous Native instance disposed before creation');active.add(key);created.push(event.kind);}
      else {assert(active.delete(key),label + ': dispose matches an active instance');}
    }
    assert.deepEqual(created,expected,label + ': exact Native chip order');
    assert.equal(active.size,0,label + ': every Native instance disposed');
  }

  try {
    for (const backend of ['native','webaudio']) {
      const url = new URL(page.url()); url.searchParams.set('mode','genesis');
      if (backend==='native') url.searchParams.set('audioEngine','native'); else url.searchParams.delete('audioEngine');
      if (page.url()!==url.href) {await page.goto(url.href);await ready(page);}
      // Observe pre-FX PCM without sending the automated test tones to the
      // listening output. This trim does not affect captureWebMix's input bus.
      if (backend==='webaudio') await page.evaluate(() => window.__nativeBackendTest.runtime.megaDrive.audio.setListeningVolume(0));
      for (const execution of ['main','worker']) {
        const workerLookaheadSeconds=await page.evaluate(() => window.__nativeBackendTest.runtime.getTiming().workerLookaheadSeconds);
        const row = {backend,execution,workerLookaheadSeconds};
        // Preserve a real previously-edited file while selecting the read-only
        // System preset, rather than only proving that an absent file stays absent.
        await page.evaluate(() => {
          const t=window.__nativeBackendTest;
          t.virtualFiles.writeText('/mixer/current.json', '{\n  "version": 1,\n  "entries": [{"id":"ym2612","name":"ym2612","settings":{"volume":0.37}}]\n}\n');
        });
        await arm(execution); await waitForMarker(10);
        row.interrupted = await stopAndObserve(backend+'/'+execution+' interrupted');
        assert.deepEqual(row.interrupted.created.map(entry=>entry.name),kinds.slice(0,11),'Stop occurs in the middle of the shipped sequence');
        if (backend==='native') {assertNativeOrder(nativeObservation,kinds.slice(0,11),execution+' interrupted',{allowBulkCleanup:true});row.interruptedNative=nativeObservation;await assertNoLiveAudio(page);}
        else {const pcm=await captureWebMix(page,.2);assert.equal(Math.max(...pcm.peak),0,'Interrupted Web playback leaves no audio tail');}
        await arm(execution);
        row.pcm=[];
        for (let index=0;index<kinds.length;index++) {
          await waitForMarker(index);
          const current=await page.evaluate(() => {
            const a=window.__chipComparisonAudit;
            return {created:a.created,connected:a.connected,result:a.result};
          });
          assert.equal(current.created.length,index+1,backend+'/'+execution+' source progress');
          assert.deepEqual(current.connected,[current.created[index].id]);
          assert.equal(current.created[index].name,kinds[index]);
          if (backend==='webaudio') {
            // Worker logs arrive while the note is still in its configured
            // lookahead. Observe the steady tone after that scheduling lead.
            const pcm=await captureWebMix(page,.25,.2+(execution==='worker'?workerLookaheadSeconds:0));
            assert.equal(pcm.nonfinite,0,kinds[index]+' finite Web PCM');
            assert.equal(pcm.overrange,0,kinds[index]+' Web mix headroom');
            assert(Math.max(...pcm.acRms)>.001,kinds[index]+' contributes an alternating waveform');
            const target=await page.evaluate(async () => (await import('./playground_mixer_defaults.js')).PLAYGROUND_MIXER_CALIBRATION.targetAmplitude);
            const expectedAmplitude=target*(['snes','spc'].includes(kinds[index])?7/8:1);
            const amplitude=Math.max(...pcm.maximum.map((high,ch)=>(high-pcm.minimum[ch])/2));
            assert(Math.abs(amplitude/expectedAmplitude-1)<.05,kinds[index]+' default amplitude within 5% of its known reference: '+amplitude+' vs '+expectedAmplitude);
            row.pcm.push({kind:kinds[index],amplitude,expectedAmplitude,...pcm});
          }
        }
        await page.waitForFunction(() => document.getElementById('consoleOutput').textContent.includes('Chip comparison complete: 21/21'), null, {timeout:20000});
        row.completed=await stopAndObserve(backend+'/'+execution+' completed');
        assert.deepEqual(row.completed.created.map(entry=>entry.name),kinds,'All21 sources play in documented order');
        assert.equal(row.completed.result.fulfilled,true,'Complete Example resolves normally');
        if (backend==='native') {row.native=nativeObservation;assertNativeOrder(nativeObservation,kinds,execution+' completed');await assertNoLiveAudio(page);}
        else {row.stopped=await captureWebMix(page,.2);assert.equal(Math.max(...row.stopped.peak),0,'Complete Web playback leaves no audio tail');}
        const text=await page.locator('#consoleOutput').innerText();
        assert.doesNotMatch(text,/\b(?:Error|TypeError|RangeError|ReferenceError):/,backend+'/'+execution+' no caught playback error');
        report.rows.push(row);
      }
      await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
      await until(()=>tracker.stats.pending===0&&tracker.stats.activeWorkers===0,backend+' final Native/Worker cleanup');
      const {resources,workletTransfers}=await page.evaluate(()=>({resources:window.__nativeLifecycleResources(),workletTransfers:window.__chipComparisonWorkletTransfers()}));
      assertChipComparisonResources(resources,workletTransfers,backend+' final');
      report[backend+'Final']={...resources,workletTransfers};
    }
    report.transport=tracker.stats;
    await fs.writeFile(path.join(artifacts,name+'-chip-comparison.json'),JSON.stringify(report,null,2));
  } catch (error) {
    report.failure={message:error.message,console:await page.locator('#consoleOutput').innerText(),native:nativeObservation,
      audit:await page.evaluate(()=>{const a=window.__chipComparisonAudit;return a?{created:a.created,connected:a.connected,result:a.result}:null;})};
    await fs.writeFile(path.join(artifacts,name+'-chip-comparison-failure.json'),JSON.stringify(report,null,2));
    throw error;
  } finally {native.invoke=originalInvoke;}
}

module.exports={runChipComparison,observeChipComparisonWorkletTransfers,assertChipComparisonResources};
