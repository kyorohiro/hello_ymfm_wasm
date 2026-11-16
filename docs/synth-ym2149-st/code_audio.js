// YM2149 ST Code borrows the editor's instrument. Only its FX rack is owned here.
import { createNativeFXRack } from '../js/native_fx_rack.js?v=prepared-fx-rerun-2';
import { createSynthCodeOutput } from '../synth/synth_code_output.js';

const cancelled = () => new DOMException('YM2149 ST Code audio stopped', 'AbortError');

// The instrument's release guard preserves a newer manual note on the same
// physical channel. Code cleanup does not release the keyboard's own lease.
function stopCodeVoices(engine) {
    if (!engine || engine.context.state === 'closed') return;
    for (let channel=0; channel<3; channel++) engine.client.keyOff(channel);
}

/** Code addresses the same three physical channels as the editor. */
export function resolveYmCodeNoteTarget(client, target, method, args) {
	if (
		!client ||
		target !== client ||
		!['noteOn', 'keyOn', 'noteOff', 'keyOff'].includes(method) ||
		!Array.isArray(args)
	)
		return null;
	return Number.isInteger(args[0]) && args[0] >= 0 && args[0] < 3
		? { target: client, channel: args[0] }
		: null;
}

const AY_METHODS = new Set(['initialize','reset','writeRegister','getRegisterSnapshot','setVoice','tone','setTone','noise','setMixer','setVolume','setEnvelope','setNoisePeriod','setTonePeriod','setFrequency','setNote','keyOn','keyOff','noteOn','noteOff','off','allNotesOff','build','compile','captureState','schedule','clearSchedule']);
/** A borrowed session owns no AudioContext. Retired callbacks cannot write. */
export function createYmBorrowedClient(engine, isCurrent, dispose) {
    const methods = new Map();
    const check = () => { if (!isCurrent()) throw cancelled(); };
    return new Proxy(Object.create(null), {
        get(_target, name) {
            if (name === 'then') return undefined;
            if (name === 'chip') return 'ay8910';
            if (name === 'id') return 'ym2149-st';
            if (name === 'channels' || name === 'channelCount') return 3;
            if (name === 'clock') return 2000000;
            if (name === 'dispose') return () => { if (isCurrent()) dispose(); };
            if (name === 'getState') return () => { check(); return {...engine.instrument.read(), registers:Array.from(engine.client.getRegisterSnapshot()), clock:2000000, initialized:true}; };
            if (name === '_timedOperations') { check(); return engine.client._timedOperations; }
            if (!AY_METHODS.has(name)) return undefined;
            if (!methods.has(name)) methods.set(name, (...args) => { check(); return engine.client[name](...args); });
            return methods.get(name);
        },
    });
}

/** Keep one source -> FX -> software Stop fade -> Master route. The final
 * monitor/Desktop output remain attached to the engine's post-Master node.
 * No independent YM2149 ST, AudioContext or speaker connection is created.
 */
export function createYmCodeAudio({
	ensureReady,
	getAudio,
	onLog = () => {},
	createFxRack = createNativeFXRack,
	createOutput = createSynthCodeOutput,
} = {}) {
	for (const callback of [ensureReady, getAudio, onLog, createFxRack, createOutput])
		if (typeof callback !== 'function')
			throw new TypeError('YM2149 ST Code audio requires host callbacks');
	let epoch = 0,
		owner = null,
		disposed = false,
		stopping = null;
	const output = createOutput({
		getContext: () => getAudio()?.context,
		getGain: () => getAudio()?.codeFadeNode,
	});
	const check = (token) => {
		if (disposed || token !== epoch) throw cancelled();
	};
	function restoreDirect(item) {
		if (!item?.routed) return;
		try {
			item.input.disconnect(item.rack.node);
		} catch {}
		try {
			item.rack.node.disconnect(item.destination);
		} catch {}
		if (item.context.state !== 'closed') item.input.connect(item.destination);
		item.routed = false;
	}
	function retire(item) {
		if (!item || item.closed) return;
		restoreDirect(item);
		item.closed = true;
		try {
			item.rack?.stop();
		} catch (error) {
			onLog(`[cleanup] ${error?.message ?? String(error)}`);
		}
		try {
			item.rack?.dispose();
		} catch (error) {
			onLog(`[cleanup] ${error?.message ?? String(error)}`);
		}
	}
	function activate(item) {
		if (!item?.rack || item !== owner || item.closed) throw cancelled();
		if (item.routed) return;
		item.input.disconnect(item.destination);
		item.input.connect(item.rack.node);
		item.rack.node.connect(item.destination);
		item.routed = true;
	}
	async function prepare() {
		const token = epoch;
		check(token);
		if (stopping) await stopping;
		check(token);
		await ensureReady();
		check(token);
		const engine = getAudio(),
			context = engine?.context,
			input = engine?.codeInputNode,
			destination = engine?.codeOutputNode;
		if (
			!context ||
			context.state === 'closed' ||
			!input ||
			!destination ||
			!engine.client || !engine.instrument
		)
			throw new Error('YM2149 ST Code needs the editor audio route');
		if (owner?.engine === engine && !owner.closed) return owner.promise;
		retire(owner);
		const item = (owner = {
			engine,
			context,
			input,
			destination,
			client: null,
			rack: null,
			closed: false,
			routed: false,
			names: new Set(),
			promise: null,
		});
		const current = () =>
			!disposed && epoch === token && owner === item && !item.closed && getAudio() === engine;
		const rack = Promise.resolve()
			.then(() => createFxRack(context))
			.then((rack) => {
				if (!current()) {
					rack.dispose();
					throw cancelled();
				}
				item.rack = rack;
				rack.onError = (message) => onLog(`[liveFx] ${message}`);
				return rack;
			});
		item.promise = Promise.all([Promise.resolve(), rack])
			.then(() => {
				if (!current()) throw cancelled();
				item.client = createYmBorrowedClient(engine, current, () => {
                    if (!current()) return;
                    epoch++; owner = null; retire(item); stopCodeVoices(engine); output.open();
                });
				return item;
			})
			.catch((error) => {
				const wasCurrent = current();
				retire(item);
				if (owner === item) owner = null;
                if (wasCurrent) Promise.resolve().then(() => stopCodeVoices(engine)).catch(() => {});
				throw error;
			});
		return item.promise;
	}
	async function useSoundChip(name) {
		if (name !== 'ay8910')
			throw new Error('YM2149 ST Synth Code supports useSoundChip("ay8910")');
		const token = epoch,
			item = await prepare();
		check(token);
		return item.client;
	}
	const fx = new Proxy(
		{},
		{
			get(_target, key) {
				const item = owner,
					controller = item?.rack?.controller;
				if (key === 'then') return undefined;
				if (typeof controller?.[key] !== 'function') return controller?.[key];
				return (...args) => {
					if (item !== owner || item.closed || disposed) throw cancelled();
					const result = controller[key](...args);
					if (key === 'liveFx') {
						item.names.add(args[0]);
						activate(item);
					} else if (key === 'removeLiveFx') {
						item.names.delete(args[0]);
						if (!item.names.size && !controller.getChain().length) restoreDirect(item);
					} else if (key === 'setChain') {
						if (item.names.size || controller.getChain().length) activate(item);
						else restoreDirect(item);
					} else if (key === 'clear' || key === 'dispose') {
						if (key === 'dispose') item.names.clear();
						if (!item.names.size) restoreDirect(item);
					}
					return result;
				};
			},
		},
	);
	function stop() {
		if (stopping) return stopping;
		epoch++;
		const item = owner;
		owner = null;
		// The runtime awaits beforeStop() before it reaches this physical cleanup.
		retire(item);
		const engine = item?.engine ?? getAudio();
		const task = Promise.resolve()
			.then(() => stopCodeVoices(engine))
			.then(() => {
				output.open();
			});
		stopping = task.finally(() => {
			if (stopping === result) stopping = null;
		});
		const result = stopping;
		return result;
	}
	async function dispose() {
		if (disposed) return;
		disposed = true;
		await stop();
	}
	return {
		prepare,
		useSoundChip,
		fx,
		resolveNoteTarget: (target, method, args) =>
			resolveYmCodeNoteTarget(owner?.client, target, method, args),
		beforeStop: () => output.fadeOut(),
		open: () => output.open(),
		stop,
		dispose,
	};
}
