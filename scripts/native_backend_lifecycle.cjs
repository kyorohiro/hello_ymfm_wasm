// Browser lifecycle stress support. Native IPC is mocked: these checks cover
// JS ownership, resource cleanup and transport fences, not device/audio quality.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

function observeNativeLifecycle() {
  const workers = new Map(), ports = new Map(), listeners = new Map();
  const callbackIds = new WeakMap(); let nextCallback = 0, nextTarget = 0;
  const originalWorker = window.Worker, originalChannel = window.MessageChannel;
  const target = value => workers.get(value) ?? ports.get(value);
  function transfers(worker, values) {
    for (const value of values ?? []) {const port = ports.get(value); if (port) port.worker = worker;}
  }
  if (originalWorker) {
    const post = originalWorker.prototype.postMessage, terminate = originalWorker.prototype.terminate;
    originalWorker.prototype.postMessage = function(message, options) {
      const result = post.call(this, message, options);
      transfers(this, Array.isArray(options) ? options : options?.transfer); return result;
    };
    originalWorker.prototype.terminate = function() {
      const record = workers.get(this); if (record) record.closed = true;
      for (const port of ports.values()) if (port.worker === this) {port.closed = true; port.reason = 'worker-terminated';}
      return terminate.call(this);
    };
    window.Worker = new Proxy(originalWorker, {construct(Type, args, NewTarget) {
      const worker = Reflect.construct(Type, args, NewTarget);
      workers.set(worker, {id:++nextTarget,closed:false,url:String(args[0])}); return worker;
    }});
  }
  if (originalChannel) {
    const close = MessagePort.prototype.close;
    MessagePort.prototype.close = function() {
      const record = ports.get(this); if (record) {record.closed = true; record.reason = 'close';}
      return close.call(this);
    };
    window.MessageChannel = new Proxy(originalChannel, {construct(Type, args, NewTarget) {
      const channel = Reflect.construct(Type, args, NewTarget);
      for (const port of [channel.port1,channel.port2]) ports.set(port, {id:++nextTarget,closed:false,worker:null});
      return channel;
    }});
  }
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  function listenerKey(object, type, callback, options) {
    const record = target(object); if (!record || !callback || !['function','object'].includes(typeof callback)) return;
    if (!callbackIds.has(callback)) callbackIds.set(callback, ++nextCallback);
    return `${record.id}:${type}:${callbackIds.get(callback)}:${Boolean(typeof options === 'boolean' ? options : options?.capture)}`;
  }
  EventTarget.prototype.addEventListener = function(type, callback, options) {
    const result = add.call(this,type,callback,options), key = listenerKey(this,type,callback,options);
    if (key) listeners.set(key, target(this)); return result;
  };
  EventTarget.prototype.removeEventListener = function(type, callback, options) {
    const result = remove.call(this,type,callback,options), key = listenerKey(this,type,callback,options);
    if (key) listeners.delete(key); return result;
  };
  window.__nativeLifecyclePortState = port => {
    const record = ports.get(port);
    return record ? {open:!record.closed,workerOwned:Boolean(record.worker)} : null;
  };
  window.__nativeLifecycleResources = () => {
    const openWorkers = [...workers].filter(([,r])=>!r.closed), openPorts = [...ports].filter(([,r])=>!r.closed);
    const handlers = [...openWorkers,...openPorts].reduce((sum,[object])=>sum+['onmessage','onmessageerror','onerror'].filter(name=>typeof object[name]==='function').length,0);
    return {workersCreated:workers.size,workersActive:openWorkers.length,portsCreated:ports.size,
      localPortsOpen:openPorts.filter(([,r])=>!r.worker).length,
      transferredPortsOpen:openPorts.filter(([,r])=>r.worker).length,
      activeTargetListeners:[...listeners.values()].filter(record=>!record.closed).length,
      activePropertyHandlers:handlers};
  };
}

function trackNativeLifecycle(native, page) {
  const invoke = native.invoke.bind(native), workers = new Set();
  const stats = {pending:0,maxPending:0,workersCreated:0,workersClosed:0,activeWorkers:0,commandsApplied:0};
  let gate = null;
  native.invoke = async(command,args) => {
    stats.pending++;stats.maxPending=Math.max(stats.maxPending,stats.pending);
    try {
      if (command === 'native_genesis_commands' && gate) {
        const current = gate; gate = null; current.arrive(); await current.promise;
      }
      const result = await invoke(command,args);
      if (command === 'native_genesis_commands') stats.commandsApplied += args.commands.length;
      return result;
    } finally {stats.pending--;}
  };
  page.on('worker', worker => {
    workers.add(worker);stats.workersCreated++;stats.activeWorkers=workers.size;
    worker.on('close',()=>{workers.delete(worker);stats.workersClosed++;stats.activeWorkers=workers.size;});
  });
  return {stats,holdCommands() {
    assert.equal(gate,null);let release,arrive;
    gate = {promise:new Promise(resolve=>{release=resolve;}),arrive:null};
    const arrived = new Promise(resolve=>{arrive=resolve;});gate.arrive=arrive;
    return {release,arrived};
  }};
}

function mockVoices(native) {
  const held = [native.ym2203,native.opna,native.opnb,...Object.values(native.x68000??{}),
    ...Object.values(native.gameGear??{}),...Object.values(native.masterSystem??{}),...Object.values(native.msx??{}),native.opl,native.wonderswan]
    .reduce((count,state)=>count+(state?.held?.size??0),0);
  return {held,pcmMask:native.pcm?.mask??255,pcmLeases:(native.pcmVoices??[]).filter(Boolean).length,
    dx7Notes:native.dx7Notes?.size??0,nesEnabled:native.nesInspector?.enabled??0,
    gameboyGates:(native.gameboyInspector?.gates??[]).filter(Boolean).length,
    hucGates:(native.hucInspector?.registers??[]).filter(row=>row[4]&128).length,
    snesEnabled:native.snes?.enabled??0,pwmQueued:native.pwmQueue?.length??0,liveFx:native.liveFx.size};
}

function containsGate(command) {
  if(command.type==='rf5c164-key-on')return true;
  if(command.type==='psg-write')return Boolean(command.value&128)&&Boolean(command.value&16)&&(command.value&15)!==15;
  if(command.type==='write')return command.register===0x28&&Boolean(command.value&240);
  const message=command.message??command;
  if(message.action==='on'||['note-on','key-on','audition-key-on'].includes(message.method))return true;
  if(message.commands?.some(message=>containsGate({...command,message})))return true;
  if(command.type==='nes'&&message.method==='enable'&&message.enabled)return true;
  if(message.method!=='write')return false;
  const register=message.register??message.address,value=message.value;
  if(['ym2203','ym2608','ym2610b'].includes(command.type))return register===0x28&&Boolean(value&240);
  if(command.type==='snes')return register===0x4c&&value!==0;
  if(command.type==='nes')return register===0x4015&&value!==0;
  if(command.type==='gameboy')return [4,9,14,19].includes(register)&&Boolean(value&128);
  if(command.type==='wonderswan')return register===0x90&&Boolean(value&15);
  if(command.type==='huc6280')return register===4&&Boolean(value&128);
  if(command.type==='x68000')return message.chip==='ym2151'&&register===8&&Boolean(value&120);
  if(command.type==='opl')return (register&255)>=0xb0&&(register&255)<=0xb8&&Boolean(value&32);
  if(['master-system','msx'].includes(command.type))return message.chip==='segapsg'?Boolean(value&128)&&Boolean(value&16)&&(value&15)!==15:message.chip==='ym2413'?register>=0x20&&register<=0x28&&Boolean(value&16):register>=8&&register<=10&&value!==0;
  return false;
}

async function runNativeLifecycle({page,native,tracker,name,artifacts,modeIds,changeMode,selectEngine,
  assertNoLiveAudio,until,source,errors}) {
  const cyclesOption=process.argv.find(value=>value.startsWith('--cycles='));
  const cycles=cyclesOption?Number(cyclesOption.slice(9)):2;
  assert(Number.isInteger(cycles)&&cycles>=1&&cycles<=20,'--cycles must be an integer from 1 to 20');
  const rows=[],boundaries=[],failures=[],fences=[];
  const report={schemaVersion:1,browser:name,cycles,modes:modeIds,mockedNative:true,
    limits:['No physical Native audio device or callback is exercised.','MessagePort counters cover main-page handles; transferred handles are retired with their owning Worker.','Listener counters cover tracked Worker/MessagePort targets and exclude closed targets; they do not measure JavaScript garbage collection.'],rows,boundaries,failures,fences};
  const write=()=>fs.writeFile(path.join(artifacts,name+'-native-lifecycle.json'),JSON.stringify({...report,transport:{...tracker.stats},errors},null,2));
  const commands=()=>native.calls.flatMap(call=>call.command==='native_genesis_commands'?call.args.commands:[]);
  const resources=()=>page.evaluate(()=>({resources:window.__nativeLifecycleResources(),audio:window.__audioConstructions,
    runtime:window.__nativeBackendTest.runtime.getState(),synth:(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;return {state:s.state,session:s.session,pending:s.pending?.length??0,acceptedCommands:s.acceptedCommands??0,acceptedRequests:s.acceptedRequests??0,listeners:s.listeners?.size??0,auditions:(s.auditions?.size??0)+(s.psgAuditions?.size??0)};})()}));
  async function drain(label) {
    await page.evaluate(async()=>{const s=window.__nativeBackendTest.runtime.megaDrive;await s.flush();await s.outputMonitor.pause();});
    await until(()=>tracker.stats.pending===0,label+' pending Native IPC');
    const state=await resources();
    assert.equal(state.synth.pending,0,label+' pending JS commands');assert.equal(state.synth.acceptedCommands,0,label+' admitted JS commands');assert.equal(state.synth.acceptedRequests,0,label+' pending JS requests');
    return state;
  }
  async function stopped(label) {
    await page.evaluate(()=>window.__nativeBackendTest.runtime.stopWithFade());
    const state=await drain(label),voices=mockVoices(native);
    assert.equal(state.runtime.playback,'stopped',label);assert.equal(state.synth.auditions,0,label+' retained audition lease');
    assert.deepEqual(voices,{held:0,pcmMask:255,pcmLeases:0,dx7Notes:0,nesEnabled:0,gameboyGates:0,hucGates:0,snesEnabled:0,pwmQueued:0,liveFx:0},label+' mock voices');
    await assertNoLiveAudio(page);return {...state,voices};
  }
  async function finalized(label) {
    await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
    await until(()=>tracker.stats.pending===0&&tracker.stats.activeWorkers===0,label+' final Worker/IPC cleanup');
    const state=await resources();
    assert.equal(state.resources.workersActive,0,label);assert.equal(state.resources.localPortsOpen,0,label);assert.equal(state.resources.transferredPortsOpen,0,label);assert.equal(state.resources.activeTargetListeners,0,label);assert.equal(state.resources.activePropertyHandlers,0,label);
    assert.equal(state.synth.listeners,0,label+' synth listeners');assert.equal(state.synth.session,null,label+' Native session');assert.equal(native.current,null,label+' mock Native session');
    return state;
  }
  try {
    await stopped('initial');
    for(let cycle=0;cycle<cycles;cycle++) {
      // Reverse the second traversal so adjacent machines and their resource
      // layouts differ from the first traversal. Repeats occur in one context.
      const order=cycle%2?[...modeIds].reverse():modeIds;
      for(const mode of order) {
        if(await page.evaluate(()=>window.__nativeBackendTest.selectedMode.id)!==mode)await changeMode(page,native,mode);
        const starter=await fs.readFile(path.resolve(__dirname,'../docs/playground/defaults',mode,'index.js'),'utf8');
        await page.evaluate(()=>window.__nativeBackendTest.runtime.initialize());
        await drain(mode+' initialize');
        let workerResources;
        const row={cycle:cycle+1,mode,session:native.current.session,runs:[]};rows.push(row);
        for(const execution of ['main','worker','worker','main']) {
          const before=commands().length;
          await page.evaluate(({starter,execution})=>window.__nativeBackendTest.runtime.playSource(starter,{execution}),{starter,execution});
          await until(()=>commands().slice(before).some(containsGate),`${mode} ${execution} authored note gate`);
          const state=await stopped(`${cycle+1}/${mode}/${execution}`),r=state.resources;
          assert.equal(native.current.session,row.session,'Run/Stop must reuse the Native session');
          if(execution==='worker') {
            assert.equal(r.workersActive,1,mode+' reusable logic Worker');
            assert.equal(tracker.stats.activeWorkers,1,mode+' real browser Worker');
            const live={workers:r.workersActive,local:r.localPortsOpen,transferred:r.transferredPortsOpen,listeners:r.activeTargetListeners,handlers:r.activePropertyHandlers};
            if(workerResources)assert.deepEqual(live,workerResources,mode+' second Worker Run/Stop must not accumulate resources');
            workerResources=live;
          } else {
            await until(()=>tracker.stats.activeWorkers===0,mode+' retired browser Worker');
            assert.equal(r.workersActive,0,mode+' Main must retire Worker');assert.equal(r.localPortsOpen,0,mode+' Main must close bridge ports');assert.equal(r.transferredPortsOpen,0,mode+' Main must retire transferred ports');assert.equal(r.activeTargetListeners,0,mode+' Main tracked listeners');assert.equal(r.activePropertyHandlers,0,mode+' Main tracked handlers');
          }
          row.runs.push({execution,commands:commands().length-before,...state});
        }
        // Exercise the real Keyboard tab after repeated execution changes.
        await page.click('#keyboardTab');
        const chip=await page.locator('#playgroundKeyboardChip option').evaluateAll(options=>options.find(option=>!option.disabled&&option.value.startsWith('chip:'))?.value);
        assert(chip,mode+' Keyboard chip');await page.selectOption('#playgroundKeyboardChip',chip);
        const channel=await page.locator('#playgroundKeyboardTargetChannel option').evaluateAll(options=>options.find(option=>!option.disabled)?.value);
        if(channel!==undefined)await page.selectOption('#playgroundKeyboardTargetChannel',channel);
        await page.locator('#keyboardTab').focus();const before=commands().length;
        await page.keyboard.down('z');await until(()=>commands().length>before,mode+' Keyboard note');
        await page.keyboard.up('z');await stopped(mode+' Keyboard release');
        row.keyboard={chip,channel,commands:commands().length-before};
        row.finalized=await finalized(mode+' finalize');
        await write();
      }
      if(await page.evaluate(()=>window.__nativeBackendTest.selectedMode.id)!=='genesis')await changeMode(page,native,'genesis');
      await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
      native.failStart=true;
      const error=await page.evaluate(async()=>{try{await window.__nativeBackendTest.runtime.initialize();return null;}catch(error){return error.message;}});
      assert.match(error,/Simulated native device unavailable/);assert.equal(native.current,null);await assertNoLiveAudio(page);
      await page.evaluate(()=>window.__nativeBackendTest.runtime.initialize());await drain('startup recovery');
      failures.push({cycle:cycle+1,error,recovered:await resources()});

      // Delay an admitted batch, enqueue a second batch, then Stop before the
      // first acknowledgement. Only the first batch may reach the mock core.
      const gate=tracker.holdCommands(),first=commands().length;
      await page.evaluate(()=>{const s=window.__nativeBackendTest.runtime.megaDrive;s.fm.noteOn(0,'A4');window.__lifecycleFirst=s.flush().then(()=>null,error=>error.name);});
      await gate.arrived;
      await page.evaluate(()=>{const r=window.__nativeBackendTest.runtime,s=r.megaDrive;s.fm.noteOn(1,'C5');window.__lifecycleQueued=s.flush().then(()=>null,error=>error.name);window.__lifecycleStop=r.stopWithFade();});
      gate.release();
      const result=await page.evaluate(async()=>{const result=await Promise.all([window.__lifecycleFirst,window.__lifecycleQueued,window.__lifecycleStop]);delete window.__lifecycleFirst;delete window.__lifecycleQueued;delete window.__lifecycleStop;return result.slice(0,2);});
      assert.deepEqual(result,[null,'AbortError']);
      const applied=commands().slice(first);assert(!applied.some(c=>c.type==='write'&&c.register===0x28&&(c.value&0xf0)&&(c.value&7)===1),'Cancelled queued channel must not gate after Stop');
      fences.push({cycle:cycle+1,result,commands:applied});await stopped('delayed command Stop');

      const workerGate=tracker.holdCommands(),workerFirst=commands().length;
      await page.evaluate(()=>window.__nativeBackendTest.runtime.playSource(`
        liveLoop('lifecycle-delayed-worker',async()=>{
          fm.noteOn(CH1,'A4');await beat(.01);fm.noteOn(CH2,'C5');await beat(.01);
        });
      `,{execution:'worker'}));
      await workerGate.arrived;
      await page.evaluate(()=>{window.__lifecycleWorkerStop=window.__nativeBackendTest.runtime.stopWithFade();});
      workerGate.release();await page.evaluate(async()=>{await window.__lifecycleWorkerStop;delete window.__lifecycleWorkerStop;});
      await stopped('delayed Worker Stop');const workerStopped=commands().length;
      // Give old timer/port messages a delivery opportunity after the Stop
      // acknowledgement. A stopped Worker may be reused, but cannot emit notes.
      await page.waitForTimeout(50);
      assert.equal(commands().length,workerStopped,'Stopped Worker must not send delayed commands after its acknowledgement');
      fences.push({cycle:cycle+1,execution:'worker',commands:commands().slice(workerFirst),stoppedResources:(await resources()).resources});

      await page.evaluate(source=>window.__nativeBackendTest.editor.setValue(source),source);
      await selectEngine(page,'webaudio');
      await page.evaluate(source=>window.__nativeBackendTest.runtime.playSource(source),source);
      assert(await page.evaluate(()=>window.__audioConstructions.contexts>0&&window.__audioConstructions.worklets.includes('ym2612-processor')));
      await page.evaluate(()=>window.__nativeBackendTest.runtime.finalize());
      boundaries.push({cycle:cycle+1,engine:'webaudio',state:await resources()});
      await selectEngine(page,'native');await page.evaluate(()=>window.__nativeBackendTest.runtime.initialize());
      await assertNoLiveAudio(page);await stopped('Native handoff');
      boundaries.push({cycle:cycle+1,engine:'native',state:await resources()});
      await write();
    }
    report.final=await finalized('final');assert.deepEqual(errors,[]);report.passed=true;await write();
    console.log(`${name}: PASS ${cycles} lifecycle cycles across ${modeIds.length} Native modes; ${rows.reduce((n,row)=>n+row.runs.length,0)} Main/Worker Run/Stops, Keyboard auditions, Web Audio handoffs, failure recovery, delayed-command fences and explicit resource cleanup; Native IPC mocked`);
  } catch(error) {report.failure={message:error.message,stack:error.stack};await write();throw error;}
}

module.exports={observeNativeLifecycle,trackNativeLifecycle,runNativeLifecycle};
