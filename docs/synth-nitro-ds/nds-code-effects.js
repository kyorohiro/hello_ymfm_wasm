// SPDX-License-Identifier: BSD-3-Clause
import { createNativeFXRack } from '../js/native_fx_rack.js?v=prepared-fx-rerun-2';

/** Optional host effects on the shared CPU-free Synth output. Each Code Run
 * owns its rack; Apply keeps it so same-name effects retain their DSP state. */
export function createNdsCodeEffects({ createFxRack = createNativeFXRack, onLog = () => {} } = {}) {
	let session = null, bpm = 120;

	function stop() {
		const previous = session;
		session = null;
		if (!previous?.rack) return;
		try {
			previous.audio.setCodeEffect(null);
			previous.rack.stop();
		} finally { previous.rack.dispose(); }
	}

	function prepare(audio) {
		if (typeof audio.setCodeEffect !== 'function') return;
		if (session?.audio === audio) return session.ready;
		stop();
		const pending = { audio, names: new Set(), rack: null, error: null };
		session = pending;
		pending.ready = Promise.resolve().then(() => createFxRack(audio.context)).then((rack) => {
			if (session !== pending) {
				rack.dispose();
				return;
			}
			pending.rack = rack;
			rack.getBeatSeconds = () => 60 / bpm;
			rack.onError = (message) => {
				if (session === pending) onLog(`[liveFx] ${message}`);
			};
		}).catch((error) => { pending.error = error; });
		return pending.ready;
	}

	const fx = new Proxy({}, {
		get(_target, method) {
			if (typeof method !== 'string' || method === 'then') return undefined;
			const current = session, controller = current?.rack?.controller;
			if (!controller) return () => {
				const details = current?.error?.message;
				throw new Error(details ? 'Code effects are unavailable: ' + details : 'Code effects are unavailable.');
			};
			if (typeof controller[method] !== 'function') return undefined;
			return (...args) => {
				if (session !== current) throw new DOMException('Code effects stopped', 'AbortError');
				const result = controller[method](...args);
				if (method === 'liveFx') current.names.add(args[0]);
				if (method === 'removeLiveFx') current.names.delete(args[0]);
				if (method === 'dispose' || (method === 'clear' && args[0]?.dispose)) current.names.clear();
				if (['liveFx', 'removeLiveFx', 'setChain', 'clear', 'dispose'].includes(method)) {
					const active = current.names.size > 0 || controller.getChain().length > 0;
					current.audio.setCodeEffect(active ? current.rack.node : null);
				}
				return result;
			};
		},
	});

	return {
		fx, prepare, stop,
		setBpm(value) {
			if (bpm === value) return;
			bpm = value;
			session?.rack?.controller.syncTempo();
		},
	};
}
