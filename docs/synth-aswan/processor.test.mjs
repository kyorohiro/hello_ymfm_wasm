import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceQueue } from '../js/playground_performance_queue.js';
import { createAswanTimedProcessor, aswanTimedCommandCost } from './timed_processor.js';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import factory from '../generated/wonderswan_wasm.js';
import { WonderSwanAudioEngine } from '../js/wonderswanaudioengine.js';
import { AswanInstrument } from './instrument.js';
import {
	validateAswanCommand,
	readAswanAuditionLoad,
	validateAswanAuditionCall,
	aswanAuditionCancelled,
} from './code_endpoint.js';
const wasmBinary = await readFile(new URL('../generated/wonderswan_wasm.wasm', import.meta.url)),
	source = await readFile(new URL('./processor.js', import.meta.url), 'utf8');
async function make(t, rate) {
	let Class;
	const messages = [];
	let calls = 0,
		serial = 0;
	vm.runInNewContext(source.replace(/import[\s\S]*?from ['"][^'"]+['"];?\n/g, ''), {
		factory: async (options) => {
			calls++;
			return factory(options);
		},
		Float32Array,
        createPerformanceQueue, createAswanTimedProcessor, aswanTimedCommandCost,
		WonderSwanAudioEngine,
		AswanInstrument,
		validateAswanCommand,
		readAswanAuditionLoad,
		validateAswanAuditionCall,
		aswanAuditionCancelled,
		sampleRate: rate,
		AudioWorkletProcessor: class {
			constructor() {
				this.port = { postMessage: (message) => messages.push(message) };
			}
		},
		registerProcessor(name, value) {
			assert.equal(name, 'tetorica-aswan-synth');
			Class = value;
		},
	});
	const p = new Class({ processorOptions: { wasmBinary } });
	await p.ready;
	assert(messages.some((message) => message.ready));
	t.after(() => p.port.onmessage({ data: { method: 'dispose' } }));
	return {
		p,
		messages,
		factoryCalls: () => calls,
		async command(method, args = []) {
			const id = ++serial;
			p.port.onmessage({ data: { id, method, args } });
			await p.ready;
			let result;
			for (let i = 0; i < 100; i++) {
				result = messages.find((message) => message.id === id);
				if (result) break;
				await new Promise((resolve) => setImmediate(resolve));
			}
			assert(result, `No reply for ${method}`);
			assert(!result.error, result.error);
			return result.value;
		},
		render(frames) {
			const left = new Float32Array(frames),
				right = left.slice();
			p.process([], [[left, right]]);
			return { left, right };
		},
	};
}
test('actual ASWAN Worklet handles keyboard, presets, physical mute, Code and exact Stop at every host rate', async (t) => {
	for (const rate of [44100, 48000, 96000]) {
		const f = await make(t, rate),
			preset = (await f.command('read')).preset;
		await f.command('noteOn', ['held', 69]);
		assert(f.render(1024).left.some((v) => Math.abs(v) > 0.01));
		const { session } = await f.command('beginCode');
		await f.command('code', [session, 'noteOn', [1, 'C4']]);
		preset.wave.fill(15);
		await f.command('setPreset', [preset, 0]);
		assert.equal((await f.command('read')).codeActive, true);
		assert((await f.command('read')).channels[0].gate);
		await f.command('setChannelEnabled', [1, false]);
		assert.equal((await f.command('read')).channels[1].enabled, false);
		await f.command('stop');
		assert(f.render(128).left.every((v) => v === 0));
		f.p.port.onmessage({ data: { id: 77, method: 'code', args: [session, 'keyOff', [1]] } });
		await Promise.resolve();
		assert.equal(f.messages.at(-1).name, 'AbortError');
	}
});

async function failure(f, method, args) {
	const id = 9999;
	const offset = f.messages.length;
	f.p.port.onmessage({ data: { id, method, args } });
	for (let i = 0; i < 100; i++) {
		const reply = f.messages.slice(offset).find((message) => message.id === id);
		if (reply) {
			assert(reply.error);
			return reply;
		}
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error(`No failure reply for ${method}`);
}
test('lazy paused audition shares one compiled module but keeps physical voices, PCM and Auto / Code state independent', async (t) => {
	const f = await make(t, 48000),
		p = (await f.command('read')).preset;
	assert.equal(f.p.audition, null);
	await f.command('noteOn', ['authored', 57, 0]);
	const { session } = await f.command('beginCode');
	await f.command('code', [session, 'noteOn', [1, 'E4']]);
	const author = await f.command('read');
	const source = structuredClone(p);
	source.envelope.enabled = true;
	source.noise.type = 3;
	source.source = 'noise';
	const loaded = await f.command('loadAudition', [
		source,
		{ token: 'noise', channel: 3, frequencyHz: 750, referenceMidi: 60 },
	]);
	assert.equal(loaded.token, 'noise');
	assert.equal(loaded.state.preset.source, 'noise');
	assert.equal(f.factoryCalls(), 1);
	assert.deepEqual(await f.command('read'), author);
	source.wave.fill(0);
	assert.notDeepEqual((await f.command('readAudition', ['noise'])).preset.wave, source.wave);
	await f.command('invokeAudition', ['noise', 'noteOn', ['preview', 60]]);
	assert.equal((await f.command('readAudition', ['noise'])).channels[3].frequency, 750);
	await f.command('setPitch', [12]);
	assert.equal((await f.command('readAudition', ['noise'])).channels[3].frequency, 1500);
	const before = f.p.instrument.read(),
		pcm = f.render(2048);
	assert(pcm.left.every(Number.isFinite));
	assert(pcm.left.some((value) => Math.abs(value) > 0.01));
	await f.command('invokeAudition', ['noise', 'noteOff', ['preview']]);
	f.render(4096);
	assert.equal((await f.command('readAudition', ['noise'])).channels[3].active, false);
	const after = await f.command('read');
	assert.equal(after.frame, before.frame + 6144);
	assert.deepEqual(after.preset, before.preset);
	assert.deepEqual(after.memory, before.memory);
	assert.deepEqual(after.voices, before.voices);
	assert(after.channels[0].gate && after.channels[1].gate);
	assert(after.codeActive);
	assert.equal(await f.command('stopAudition', ['stale']), false);
	await f.command('stopAudition', ['noise']);
	assert.equal((await f.command('read')).codeActive, true);
});
test('preview Wave edits preserve its held gate; malformed loads / calls and stale tokens cannot change a newer owner', async (t) => {
	const f = await make(t, 44100),
		p = (await f.command('read')).preset;
	await f.command('loadAudition', [p, { token: 'A', channel: 2, frequencyHz: 750 }]);
	await f.command('invokeAudition', ['A', 'noteOn', ['same-key', 60]]);
	f.render(1024);
	const next = structuredClone(p);
	next.wave.fill(15);
	next.sweep.enabled = true;
	next.sweep.step = 1;
	await f.command('invokeAudition', ['A', 'setPreset', [next]]);
	const current = await f.command('readAudition', ['A']);
	assert(current.channels[2].gate);
	assert.equal(current.voices[0].id, 'same-key');
	for (const [method, args] of [
		[
			'loadAudition',
			[
				{ ...p, source: 'pcm' },
				{ token: 'bad', channel: 1 },
			],
		],
		['loadAudition', [p, { token: 'bad', clock: 3000000 }]],
		['invokeAudition', ['A', 'setPreset', [{ ...p, left: 16 }]]],
		['invokeAudition', ['A', 'noteOn', ['x', 999]]],
		['invokeAudition', ['A', 'writeRegister', [0x90, 0]]],
	]) {
		await failure(f, method, args);
		assert.deepEqual(await f.command('readAudition', ['A']), current);
	}
	await f.command('loadAudition', [p, { token: 'B', channel: 0 }]);
	await f.command('invokeAudition', ['B', 'noteOn', ['same-key', 69]]);
	const fresh = await f.command('readAudition', ['B']);
	assert.equal(
		(await failure(f, 'invokeAudition', ['A', 'noteOff', ['same-key']])).name,
		'AbortError',
	);
	assert.equal(await f.command('stopAudition', ['A']), false);
	assert.deepEqual(await f.command('readAudition', ['B']), fresh);
	await f.command('setChannelEnabled', [0, false]);
	assert.equal((await f.command('readAudition', ['B'])).channels[0].enabled, false);
	assert(f.render(1024).left.every((value) => value === 0));
	await f.command('stop');
	assert.equal((await failure(f, 'readAudition', ['B'])).name, 'AbortError');
	assert(f.render(128).left.every((value) => value === 0));
});
test('authored + audition mixing and software release remain bit exact across render partitions at all host rates', async (t) => {
	for (const rate of [44100, 48000, 96000]) {
		const a = await make(t, rate),
			b = await make(t, rate),
			p = (await a.command('read')).preset;
		for (const f of [a, b]) {
			await f.command('noteOn', ['author', 57]);
			await f.command('loadAudition', [
				p,
				{ token: 'preview', channel: 1, frequencyHz: 750 },
			]);
			await f.command('invokeAudition', ['preview', 'noteOn', ['note', 72]]);
		}
		const whole = a.render(4096),
			left = new Float32Array(4096),
			right = left.slice();
		for (let at = 0; at < 4096; at += 37) {
			const part = b.render(Math.min(37, 4096 - at));
			left.set(part.left, at);
			right.set(part.right, at);
		}
		assert.deepEqual(whole, { left, right });
		for (const f of [a, b]) await f.command('invokeAudition', ['preview', 'noteOff', ['note']]);
		assert.deepEqual(a.render(4096), b.render(4096));
		assert.equal(a.factoryCalls(), 1);
	}
});
test('Stop / Code / disposal during lazy audition startup fences the delayed preview without resurrecting it', async (t) => {
	for (const action of ['stopAudition', 'beginCode', 'dispose']) {
		const f = await make(t, 48000),
			p = (await f.command('read')).preset;
		let finish;
		const original = f.p.ensureAudition.bind(f.p);
		f.p.ensureAudition = () =>
			new Promise((resolve, reject) => (finish = () => original().then(resolve, reject)));
		f.p.port.onmessage({
			data: { id: 500, method: 'loadAudition', args: [p, { token: 'pending', channel: 0 }] },
		});
		await Promise.resolve();
		assert.equal(typeof finish, 'function');
		if (action === 'dispose') f.p.port.onmessage({ data: { method: 'dispose' } });
		else await f.command(action, action === 'stopAudition' ? ['pending'] : []);
		finish();
		for (let i = 0; i < 100 && !f.messages.some((message) => message.id === 500); i++)
			await new Promise((resolve) => setImmediate(resolve));
		assert.equal(f.messages.find((message) => message.id === 500)?.name, 'AbortError');
		assert.equal(f.p.auditionToken, null);
		if (action !== 'dispose') assert(f.render(128).left.every((value) => value === 0));
	}
});
test('muted private native preview cannot change a running authored chip waveform or phase', async (t) => {
	const a = await make(t, 48000),
		b = await make(t, 48000),
		p = (await a.command('read')).preset;
	for (const f of [a, b]) {
		await f.command('noteOn', ['author', 69]);
		const { session } = await f.command('beginCode');
		await f.command('code', [session, 'noteOn', [1, 60]]);
	}
	const preview = { ...p, source: 'noise', noise: { type: 7 } };
	await a.command('loadAudition', [preview, { token: 'isolated', channel: 3, frequencyHz: 750 }]);
	for (let ch = 0; ch < 4; ch++) a.p.audition.setChannelEnabled(ch, false);
	await a.command('invokeAudition', ['isolated', 'noteOn', ['noise', 60]]);
	assert.deepEqual(a.render(8192), b.render(8192));
	assert.deepEqual(await a.command('read'), await b.command('read'));
});
test('malformed host commands do not stop a running native owner or overwrite its PCM', async (t) => {
	const f = await make(t, 48000);
	await f.command('noteOn', ['held', 69]);
	const before = await f.command('read');
	for (const [method, args] of [
		['stop', [true]],
		['setPreset', []],
		['noteOff', []],
		['setChannelEnabled', [0, 'false']],
	]) {
		f.p.port.onmessage({ data: { id: 88, method, args } });
		await Promise.resolve();
		assert(f.messages.at(-1).error);
		assert.deepEqual(await f.command('read'), before);
	}
});

// Real WASM Worklet execution, with exact register write frames recorded at the
// core boundary. No AudioContext or speaker output is created by these tests.
for (const rate of [44100,48000]) test(`ASWAN timed execution preserves partial controls and matches compilation at ${rate} Hz`,async t=>{
  const {buildAswanOperations:build,compileAswanOperations:compile}=await import('./operations.js');
  const f=await make(t,rate), {session}=await f.command('beginCode');
  await f.command('code',[session,'noteOn',[0,60]]);
  const voice=f.p.instrument.owners[0];
  const plan=build(b=>{b.atSample(441).setNoise({enabled:true,type:2,reset:true});b.atSeconds(.01).setSweep({enabled:true,step:1,time:3});});
  const receipt=await f.command('timed',[session,{action:'schedule',operations:plan,options:{name:'motion'}}]);
  await f.command('code',[session,'setVoiceMode',[true]]);
  const initial=f.p.instrument.synth._getState(), expected=compile(plan,initial), writes=[];
  const core=f.p.instrument.core, original=core.writeWonderSwan.bind(core);
  core.writeWonderSwan=(register,value)=>{writes.push({frame:f.p.renderedFrames,register:register+0x80,value});return original(register,value);};
  f.render(receipt.startFrame+Math.round(rate*.01));
  assert.equal(writes.filter(w=>w.register===0x8e).length,0,'event at end belongs to next render');
  f.render(1);
  const rows=writes.filter(w=>[0x8e,0x8c,0x8d,0x90].includes(w.register));
  assert.deepEqual(rows.map(({register,value})=>({register,value})),expected.map(({register,value})=>({register,value})));
  assert(rows.every(w=>w.frame===receipt.startFrame+Math.round(rate*.01)));
  assert.equal(f.p.instrument.owners[0],voice,'parameter writes retain note ownership');
  assert(f.p.instrument.synth._getState().registers[16]&0x21,'manual Voice mode and gate preserved');
});
test('ASWAN timed reservations reject atomically, stage Apply transactions, replace names and fence Stop / stale leases',async t=>{
  const {buildAswanOperations:build}=await import('./operations.js');
  const f=await make(t,48000),{session}=await f.command('beginCode');
  const plan=build(b=>b.setVolume(0,4,6)),payload={action:'schedule',operations:plan,options:{name:'motion',repeatSeconds:.1}};
  await f.command('timed',[session,payload]);
  const count=()=>f.p.timeline.getStats().patternCount;
  assert.equal(count(),1);
  await failure(f,'timed',[session,{...payload,operations:build(b=>b.setVolume(0,99))}]);assert.equal(count(),1);
  await failure(f,'timed',[session,{...payload,options:{name:'motion',repeatSeconds:1e-9}}]);assert.equal(count(),1);
  await f.command('timed',[session,{action:'stage',transactionId:1,owner:'loop:a',method:'schedule',args:[plan,{name:'second'}]}]);assert.equal(count(),1);
  await f.command('timed',[session,{action:'abort',transactionId:1,owner:'loop:a'}]);assert.equal(count(),1);
  await f.command('timed',[session,{action:'stage',transactionId:2,owner:'loop:a',method:'schedule',args:[plan,{name:'second',repeatSeconds:.1}]}]);
  await f.command('timed',[session,{action:'commit',transactionId:2,owner:'loop:a'}]);assert.equal(count(),2);
  await f.command('timed',[session,{action:'cancelOwner',owner:'loop:a'}]);assert.equal(count(),1);
  await f.command('timed',[session,{...payload,operations:build(b=>b.setVolume(0,9))}]);assert.equal(count(),1);
  const old=await f.command('timed',[session,{action:'capture'}]);
  await f.command('stop');assert.equal(count(),0);f.render(20000);
  const next=await f.command('beginCode');
  await failure(f,'timed',[session,payload]);assert.equal(count(),0);
  const snapshot=await f.command('timed',[next.session,{action:'capture'}]);assert.notEqual(old.instanceId,snapshot.instanceId);
  await f.command('timed',[next.session,payload]);await failure(f,'endCode',[session]);assert.equal(count(),1,'stale end cannot clear newer reservations');
  await f.command('code',[next.session,'initialize',[]]);assert.equal(count(),0);
});
for (const rate of [44100,48000]) test(`ASWAN repeating offsets do not accumulate rounding drift at ${rate} Hz`,async t=>{
  const {buildAswanOperations:build}=await import('./operations.js');
  const f=await make(t,rate),{session}=await f.command('beginCode'),frames=[];
  const core=f.p.instrument.core, original=core.writeWonderSwan.bind(core);
  core.writeWonderSwan=(register,value)=>{if(register===14)frames.push(f.p.renderedFrames);return original(register,value);};
  const receipt=await f.command('timed',[session,{action:'schedule',operations:build(b=>b.atSample(1).setNoise({enabled:true,reset:true})),options:{name:'reset-noise',repeatSeconds:1/110}}]);
  const count=40, end=receipt.startFrame+Math.round(((count-1)/110+1/44100)*rate)+1;
  for(let at=0;at<end;){const n=Math.min(127,end-at);f.render(n);at+=n;}
  assert.deepEqual(frames,Array.from({length:count},(_,i)=>receipt.startFrame+Math.round((i/110+1/44100)*rate)));
  await f.command('timed',[session,{action:'clear',name:'reset-noise'}]);f.render(2000);assert.equal(frames.length,count);
});

test('real Code runtime stages ASWAN Apply and cancels per-loop reservations without cancelling another loop',async t=>{
  const {createPlaygroundCodeRuntime}=await import('../js/playground_code_runtime.js');
  const {createAswanCodeClient}=await import('./code_endpoint.js');
  const f=await make(t,48000), metadata=await f.command('beginCode');let current=true;
  const client=createAswanCodeClient({metadata,invoke:(method,args)=>f.command('code',[metadata.session,method,args]),
    isCurrent:()=>current,dispose(){current=false;},requestControl:payload=>f.command('timed',[metadata.session,payload])});
  const logs=[];
  const runtime=createPlaygroundCodeRuntime({ensureReady:async()=>{},now:()=>performance.now()/1000,
    supportedSoundChips:['wonderswan'],useSoundChip:async()=>client,stopSoundChips:async()=>{},
    guardExecution:false,createTaskChannel:()=>null,onLog:line=>logs.push(line)});
  t.after(()=>runtime.stop());
  const source=`const ws=await useSoundChip('wonderswan');const plan=ws.build(b=>b.setVolume(CH1,4,5));
    await ws.schedule(plan,{name:'entry',repeatSeconds:.1});`;
  await runtime.run(source);assert.equal(f.p.timeline.getStats().patternCount,1);
  await runtime.apply(source+`throw Error('reject this evaluation');`).catch(()=>{});
  assert.equal(f.p.timeline.getStats().patternCount,1);
  await runtime.apply(source+`
    context.cancel=()=>stopLoop('one');
    liveLoop('one',async()=>{await ws.schedule(plan,{name:'one',repeatSeconds:.1});await beat(100);});
    liveLoop('two',async()=>{await ws.schedule(plan,{name:'two',repeatSeconds:.1});await beat(100);});`);
  for(let i=0;i<100&&f.p.timeline.getStats().patternCount!==3;i++)await new Promise(r=>setTimeout(r,1));
  assert.equal(f.p.timeline.getStats().patternCount,3,logs.join('\n'));
  runtime.getContext().cancel();
  for(let i=0;i<100&&f.p.timeline.getStats().patternCount!==2;i++)await new Promise(r=>setTimeout(r,1));
  assert.equal(f.p.timeline.getStats().patternCount,2);
  await runtime.stop();assert.equal(f.p.timeline.getStats().patternCount,0);
});
test('a later CH2 Voice-mode conflict cancels only the offending reservation and leaves audio usable',async t=>{
  const {buildAswanOperations:build}=await import('./operations.js');
  const f=await make(t,48000),{session}=await f.command('beginCode');
  await f.command('timed',[session,{action:'schedule',operations:build(b=>b.setVolume(1,4,5)),options:{name:'stereo',repeatSeconds:.1}}]);
  await f.command('code',[session,'setVoiceMode',[true]]);
  f.render(129);
  assert.equal(f.p.timeline.getStats().patternCount,0);
  assert(f.messages.some(message=>message.type==='aswan-timed-error'&&/Voice PCM feeding/.test(message.message)));
  assert(!f.messages.some(message=>message.fatal));
  assert.equal((await f.command('read')).codeActive,true);
  await f.command('code',[session,'noteOn',[0,60]]);
  assert(f.render(1024).left.some(value=>value!==0),'unrelated Wave channel still plays');
});
