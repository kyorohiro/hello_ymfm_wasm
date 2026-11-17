import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {YM_CODE_EXAMPLES} from './code_examples.js';
import {AY8910Synth} from '../js/ay8910synth.js';
import {Ay8910} from '../js/ay8910.js';
import {buildAyOperations, compileAyOperations} from '../js/ay8910_operations.js';
import {createPlaygroundMusic} from '../js/playground_music.js';
import {createPerformanceQueue} from '../js/playground_performance_queue.js';
import ayFactory from '../generated/ay8910_wasm.js';

const clock=2_000_000,
	wasmBinary=readFileSync(new URL('../generated/ay8910_wasm.wasm',import.meta.url)),
	melodyMidi=[52,55,57,59,62],
	frequency=midi=>440*2**((midi-69)/12);

async function runExample() {
	const writes=[],events=[],traces=[],tables=[],schedules=[],cleanups=[],beats=[],loops=new Map(),
		ym=new AY8910Synth({clock,transport:{writeRegister(register,value){writes.push({register,value});}}});
	// Setup must be safe even when the previous sound enabled all three voices.
	ym.initialize();
	for(let channel=0;channel<3;channel++)ym.setVoice(channel,{tone:true,noise:true,volume:12,envelope:true});
	writes.length=0;
	const keyOn=ym.keyOn.bind(ym),keyOff=ym.keyOff.bind(ym);
	ym.keyOn=channel=>{events.push({kind:'keyOn',channel});return keyOn(channel);};
	ym.keyOff=channel=>{events.push({kind:'keyOff',channel});return keyOff(channel);};
	ym.build=buildAyOperations;
	ym.compile=async(plan,options)=>{
		assert.deepEqual(options,{initialState:'client'});
		const rows=compileAyOperations(plan,ym._getState(),{clock});traces.push(rows);return rows;
	};
	ym.schedule=async(plan,options)=>{
		const state=ym._getState(),rows=compileAyOperations(plan,state,{clock});
		schedules.push({plan,options,state,rows,writeIndex:writes.length});
		events.push({kind:'schedule',name:options.name});
		return{name:options.name,entries:plan.operations.length};
	};
	ym.clearSchedule=async name=>{events.push({kind:'clear',name});};
	// These are the same music helpers exposed by the real Code runtime. Their
	// musical constants are test fixtures; no tone hardware is used for pitch.
	const music=createPlaygroundMusic({
		noteToSemitone:{C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,A:9,'A#':10,Bb:10,B:11},
		scaleIntervals:{minorPentatonic:[0,3,5,7,10]},
	});
	const globals={
		async useSoundChip(name){assert.equal(name,'ay8910');return ym;},
		setBpm(value){assert.equal(value,120);},CH1:0,CH2:1,CH3:2,
		parseNoteName:music.parseNoteName,scale:music.scale,
		liveLoop:(name,callback)=>loops.set(name,callback),
		liveCleanup:(names,callback)=>cleanups.push({names,callback}),
		beat:async value=>{beats.push(value);events.push({kind:'beat',value});},
		console:{log(){},table:rows=>tables.push(rows)},
	};
	const source=YM_CODE_EXAMPLES['/examples/envelope-melody.js'];
	assert.equal(typeof source,'string','Files supplies the actual editable example');
	const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
	await new AsyncFunction(...Object.keys(globals),source)(...Object.values(globals));
	const setup=ym._getState();
	async function nextNote(){
		const count=schedules.length;
		await loops.get('envelope-melody')();
		assert.equal(schedules.length,count+1);
		const scheduled=schedules.at(-1);
		scheduled.endWrites=writes.slice(scheduled.writeIndex);
		return scheduled;
	}
	return{source,ym,setup,writes,events,traces,tables,schedules,cleanups,beats,loops,nextNote};
}

test('the editable envelope melody derives its notes from R13 timing, leaving Tone and Noise disabled',async()=>{
	const example=await runExample(),{ym,setup,writes,traces,tables,schedules,beats,loops,events,cleanups}=example;
	assert.equal(setup.registers[7]&9,9,'CH1 tone and noise are disabled');
	assert.equal(setup.registers[7]&0x36,0,'other channels\' mixer bits are preserved');
	assert.deepEqual(setup.registers.slice(8,11),[0,0,0],'setup stays silent until the first note');
	assert.equal(setup.levels[0],16,'Key On retains Envelope mode');
	assert.equal(setup.registers[11]|setup.registers[12]<<8,100);
	assert.equal(setup.registers[13],9,'the client/UI shadow and scheduled Envelope shape agree');
	assert.deepEqual([...loops.keys()],['envelope-melody']);
	assert.equal(schedules.length,0,'recording/inspection do not execute a live loop');
	assert.equal(traces.length,1);
	assert.deepEqual(traces[0].map(row=>[row.offsetSeconds,row.register,row.value]),[[0,13,9]],
		'Shape9 is written even when equal: a single decay followed by zero hold');
	assert.deepEqual(tables,[traces[0]]);
	const setupTone=setup.registers.slice(0,6);
	writes.length=0;events.length=0;
	for(let index=0;index<melodyMidi.length+1;index++){
		// Manual Period edits remain in effect: only R13 belongs to the repeat.
		const period=index%2===0?30:200;
		ym.setEnvelope({period});
		const start=events.length,scheduled=await example.nextNote();
		assert.deepEqual(scheduled.options,{name:'envelope-melody',repeatSeconds:1/frequency(melodyMidi[index%melodyMidi.length])});
		assert.equal(scheduled.plan.referenceSampleRate,44100);
		assert.equal(scheduled.plan.operations.length,1,'the repeat is compact, not expanded note samples');
		assert.equal(scheduled.state.registers[8],16,'Envelope output is restored before accepting the note');
		assert.equal(scheduled.state.registers[11]|scheduled.state.registers[12]<<8,period);
		assert.deepEqual(scheduled.rows.map(row=>[row.register,row.value]),[[13,9]]);
		assert.deepEqual(scheduled.endWrites,[{register:8,value:0}]);
		assert.deepEqual(events.slice(start),[
			{kind:'keyOn',channel:0},{kind:'schedule',name:'envelope-melody'},
			{kind:'beat',value:0.8},{kind:'clear',name:'envelope-melody'},
			{kind:'keyOff',channel:0},{kind:'beat',value:0.2},
		]);
		assert.equal(ym.getRegisterSnapshot()[8],0,'note rest remains silent after cancellation');
	}
	assert.deepEqual(ym.getRegisterSnapshot().slice(0,6),Uint8Array.from(setupTone),
		'the melody never programs the hardware Tone oscillator');
	assert.deepEqual(beats,Array.from({length:melodyMidi.length+1},()=>[0.8,0.2]).flat());
	assert.equal(cleanups.length,1);assert.deepEqual(cleanups[0].names,['envelope-melody']);
	ym.keyOn(0);writes.length=0;
	await cleanups[0].callback();
	assert.deepEqual(writes,[{register:8,value:0}], 'owner cleanup releases the last Envelope level');
});

test('the note release waits for cancellation acceptance before keyOff or rest',async()=>{
	const example=await runExample(),{ym,events,loops}=example;
	events.length=0;
	let release;
	ym.clearSchedule=name=>{
		events.push({kind:'clearRequested',name});
		return new Promise(resolve=>{release=()=>{events.push({kind:'clearAccepted'});resolve();};});
	};
	const pending=loops.get('envelope-melody')();
	for(let turn=0;turn<20&&!release;turn++)await Promise.resolve();
	assert.equal(typeof release,'function');
	assert(!events.some(event=>event.kind==='keyOff'||event.kind==='beat'&&event.value===0.2));
	assert.equal(ym.getRegisterSnapshot()[8],16);
	release();await pending;
	const accepted=events.findIndex(event=>event.kind==='clearAccepted'),
		off=events.findIndex(event=>event.kind==='keyOff');
	assert(off>accepted);assert.equal(ym.getRegisterSnapshot()[8],0);
});

async function renderPattern(scheduled,sampleRate,{period=100,repeating=true,duration=0.75}={}){
	const chip=await Ay8910.create({moduleFactory:ayFactory,moduleOptions:{wasmBinary},clock,type:0x10,flags:1,sampleRate});
	try{
		scheduled.state.registers.forEach((value,register)=>chip.writeRegister(register,value));
		chip.writeRegister(11,period&255);chip.writeRegister(12,period>>8);
		// Raw zero-code output has an electrical DC baseline. Isolate CH1 instead
		// of allowing the two silent voices' baselines to hide a release bug.
		chip.setMuteMask(6);
		const stopFrame=Math.round(duration*sampleRate),tailFrames=Math.round(0.02*sampleRate),
			pcm=new Float32Array(stopFrame+tailFrames),writes=[];
		let frame=0;
		// Run the production compact-pattern queue, partitioning PCM like a
		// Worklet. Expected sample frames below are an independent arithmetic
		// oracle, rather than the same rounding code that executes the writes.
		const queue=createPerformanceQueue({sampleRate,nowFrame:()=>frame,
			apply(command,_reply,at){
				const[register,value]=command.args;chip.writeRegister(register,value);
				writes.push({frame:at,register,value});
			},
		});
		queue.receive({type:'performance-start',session:1});
		queue.schedulePattern({name:scheduled.options.name,
			entries:scheduled.rows.map(row=>({offsetSeconds:row.offsetSeconds,
				command:{method:'writeRegister',args:[row.register,row.value]}})),
			performance:{session:1,owner:'envelope-melody',time:0},
			...(repeating?{repeatSeconds:scheduled.options.repeatSeconds}:{}),
		});
		while(frame<stopFrame){
			queue.advance(frame);
			const next=Math.min(stopFrame,frame+128,Math.max(frame+1,queue.nextFrame()));
			pcm.set(chip.generateStereo(next-frame).left,frame);frame=next;
		}
		queue.clearPattern(scheduled.options.name,{session:1,owner:'envelope-melody'});
		assert.equal(queue.getStats().patternCount,0,'cancellation clears the production repeated pattern');
		for(const row of scheduled.endWrites)chip.writeRegister(row.register,row.value);
		while(frame<pcm.length){
			queue.advance(frame);
			const next=Math.min(pcm.length,frame+128);
			pcm.set(chip.generateStereo(next-frame).left,frame);frame=next;
		}
		assert.equal(queue.getStats().lateCommands,0);
		return{pcm,writes,stopFrame};
	}finally{chip.dispose();}
}

function waveformStats(pcm,sampleRate,expectedHz){
	const start=Math.round(sampleRate*0.03),signal=pcm.subarray(start),
		low=Math.min(...signal),high=Math.max(...signal),range=high-low,edges=[];
	let sum=0,square=0;
	for(let index=0;index<signal.length;index++){
		const value=signal[index];sum+=value;square+=value*value;
		if(index&&value-signal[index-1]>range*0.25&&(!edges.length||index-edges.at(-1)>sampleRate/expectedHz*0.5))edges.push(index);
	}
	assert(edges.length>25,'hardware Envelope produces a train of distinct retrigger edges');
	return{range,mean:sum/signal.length,acRms:Math.sqrt(square/signal.length-(sum/signal.length)**2),
		observedHz:(edges.length-1)*sampleRate/(edges.at(-1)-edges[0]),edges};
}

for(const sampleRate of [44100,48000]){
	test(`shipped YM2149 produces the authored envelope pitches and sample-rounded R13 repeats at ${sampleRate} Hz`,async t=>{
		const example=await runExample();
		// E3 and A3 exercise fractional output-frame periods at both device rates.
		for(const [index,midi]of melodyMidi.entries()){
			const scheduled=await example.nextNote();
			if(![0,2].includes(index))continue;
			const hz=frequency(midi),rendered=await renderPattern(scheduled,sampleRate),
				active=rendered.pcm.subarray(0,rendered.stopFrame),stats=waveformStats(active,sampleRate,hz);
			assert(active.every(Number.isFinite));assert(stats.acRms>0.005);
			assert(Math.abs(stats.observedHz-hz)<0.15,`measured ${stats.observedHz} Hz, expected ${hz} Hz`);
			const steps=new Set();
			for(const [cycle,write]of rendered.writes.entries()){
				assert.deepEqual([write.register,write.value],[13,9]);
				const idealFrame=cycle*sampleRate/hz;
				assert.equal(write.frame,Math.round(idealFrame));
				assert(Math.abs(write.frame-idealFrame)<=0.500001);
				if(cycle)steps.add(write.frame-rendered.writes[cycle-1].frame);
			}
			assert.equal(steps.size,2,'fractional periods alternate frame intervals instead of accumulating clock drift');
			assert(rendered.pcm.subarray(rendered.stopFrame+1).every(value=>value===Math.fround(-0.125/3)),
				'after cancellation and source-authored keyOff, the raw DAC reaches its exact zero-code electrical baseline');
			const oneShot=await renderPattern(scheduled,sampleRate,{repeating:false}),
				settled=oneShot.pcm.subarray(Math.round(sampleRate*0.05),oneShot.stopFrame);
			assert(settled.every(value=>value===Math.fround(-0.125/3)),
				'Shape9 without repeated R13 writes decays to zero and cannot sustain a hidden Tone or natural Envelope oscillator');
			t.diagnostic(JSON.stringify({kind:'pitch',sampleRate,midi,expectedHz:hz,observedHz:stats.observedHz,
				acRms:stats.acRms,range:stats.range,retriggerFrameSteps:[...steps].sort((a,b)=>a-b),
				storedPatternEntries:scheduled.rows.length,rawZeroReleaseExact:true,withoutRetriggersDecaysToZero:true}));
		}
	});

	test(`Envelope Period edits change timbre while retrigger pitch remains fixed at ${sampleRate} Hz`,async t=>{
		const example=await runExample(),scheduled=await example.nextNote(),hz=frequency(melodyMidi[0]),stats=[];
		for(const period of [30,100,200]){
			const rendered=await renderPattern(scheduled,sampleRate,{period}),
				active=rendered.pcm.subarray(0,rendered.stopFrame),stat=waveformStats(active,sampleRate,hz);
			assert(Math.abs(stat.observedHz-hz)<0.15);
			assert(stat.range>0.08&&stat.acRms>0.005);
			stats.push(stat);
			// A short single decay finishes before the next pitch pulse. It holds
			// zero instead of introducing extra natural-envelope repetitions.
			if(period===30)assert(active.filter(value=>value===Math.fround(-0.125/3)).length>active.length*0.2);
		}
		assert(stats[2].mean-stats[0].mean>0.04,'slower Envelope decay changes the pulse profile substantially');
		assert(stats[0].range-stats[2].range>0.02,'Period changes waveform extent, not the software pitch period');
		t.diagnostic(JSON.stringify({kind:'timbre',sampleRate,expectedHz:hz,periods:[30,100,200],
			profiles:stats.map(({range,mean,acRms,observedHz})=>({range,mean,acRms,observedHz})),
			meanDelta:stats[2].mean-stats[0].mean,rangeDelta:stats[0].range-stats[2].range}));
	});
}
