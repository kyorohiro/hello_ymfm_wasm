// SPDX-License-Identifier: BSD-3-Clause

const MAX_REPEAT_SECONDS = 60;

function scheduleName(name) {
	if (typeof name !== 'string' || !name.length || name.length > 256)
		throw new TypeError('Provide a schedule name of 1–256 characters.');
	return name;
}

function scheduleOptions(settings) {
	if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
		Object.keys(settings).some(key => key !== 'name' && key !== 'repeatSeconds'))
		throw new TypeError('Schedule options are name and repeatSeconds.');
	const name = scheduleName(settings.name), repeatSeconds = settings.repeatSeconds;
	if (repeatSeconds !== undefined && (!Number.isFinite(repeatSeconds) || repeatSeconds <= 0 || repeatSeconds > MAX_REPEAT_SECONDS))
		throw new RangeError('repeatSeconds must be greater than zero and at most 60 seconds.');
	return { name, repeatSeconds };
}

export function createTimedSchedule({ nextStartTime }) {
	const channels = new Map(), transactions = new Map();
	const committed = new Map(), aborted = new Map();
	const defaultOwner = Symbol('SM Synth direct schedules');

	async function prepareRecord(channel, plan, record) {
		const playback = await channel.prepare(plan, record.repeatSeconds);
		if (!playback || !Number.isFinite(playback.duration) || playback.duration < 0 || typeof playback.play !== 'function')
			throw new TypeError('A prepared schedule needs a duration and a play function.');
		if (record.repeatSeconds !== undefined && record.repeatSeconds < playback.duration)
			throw new RangeError('repeatSeconds must cover the entire sequence.');
		return playback;
	}

	function receipt({ name, repeatSeconds, playback }, details) {
		return { name, duration: playback.duration, ...(repeatSeconds === undefined ? {} : { repeatSeconds }), ...details };
	}

	function stopActive(channel) {
		const active = channel.active;
		channel.active = null;
		return active?.stop();
	}

	function start(channel, record, time) {
		const result = record.playback.play(time, record.repeatSeconds);
		const { stop, startTime = time } = typeof result === 'function' ? { stop: result } : result ?? {};
		if (typeof stop !== 'function') throw new TypeError('Playback must provide a stop function.');
		channel.active = { name: record.name, owner: record.owner, stop };
		return receipt(record, { startTime });
	}

	function clear(channel, name, owner) {
		const matches = current => current?.name === name && current.owner === owner;
		const pending = matches(channel.pending), active = matches(channel.active);
		if (pending) channel.pending = null;
		if (active) stopActive(channel);
		return pending || active;
	}

	function cancelOwner(owner) {
		for (const [id, transaction] of transactions) {
			if (transaction.owner === owner) transactions.delete(id);
		}
		committed.delete(owner);
		aborted.delete(owner);
		for (const channel of channels.values()) {
			if (channel.pending?.owner === owner) channel.pending = null;
			if (channel.active?.owner === owner) stopActive(channel);
		}
	}

	function abort(id, owner) {
		if (committed.get(owner)?.id === id) return;
		if (transactions.get(id)?.owner === owner) transactions.delete(id);
		aborted.set(owner, id);
	}

	function commit(id, owner) {
		const previous = committed.get(owner);
		if (previous?.id === id) return previous.result;
		if (aborted.get(owner) === id) return false;
		const transaction = transactions.get(id);
		if (transaction && transaction.owner !== owner) throw new TypeError('Schedule transaction owner mismatch.');
		const changes = [];
		for (const channel of channels.values()) {
			let choice = null;
			for (const record of transaction?.records.get(channel) ?? []) {
				if (record.clear) {
					if (choice?.name === record.name) choice = null;
				} else {
					if (!record.playback) throw new Error('The schedule is still preparing.');
					choice = record;
				}
			}
			if (choice || channel.active?.owner === owner || channel.pending?.owner === owner)
				changes.push({ channel, choice });
		}
		transactions.delete(id);

		// Commit every channel in this evaluation once, at a shared clock anchor.
		// The runtime also calls commit on the other participating capabilities.
		let time = nextStartTime();
		for (const { channel, choice } of changes) {
			if (choice || channel.pending?.owner === owner) channel.pending = null;
			if (choice || channel.active?.owner === owner) time = Math.max(time, stopActive(channel) ?? time);
		}
		const reservations = [];
		for (const { channel, choice } of changes) {
			if (choice) reservations.push(start(channel, choice, time));
		}
		const result = { reservations };
		committed.set(owner, { id, result });
		return result;
	}

	return {
		createClient({ prepare, channel: name }) {
			if (!name || typeof prepare !== 'function') throw new TypeError('A schedule channel needs a name and a prepare function.');
			if (channels.has(name)) throw new Error('Share the existing schedule client for this channel.');
			const channel = { prepare, active: null, pending: null };
			channels.set(name, channel);
			return {
				async schedule(plan, settings, { owner = defaultOwner } = {}) {
					const record = { ...scheduleOptions(settings), owner };
					channel.pending = record;
					try {
						record.playback = await prepareRecord(channel, plan, record);
						if (channel.pending !== record) return false;
						return start(channel, record, Math.max(nextStartTime(), stopActive(channel) ?? 0));
					} catch (error) {
						if (channel.pending !== record) return false;
						throw error;
					} finally {
						if (channel.pending === record) channel.pending = null;
					}
				},
				async clearSchedule(name, { owner = defaultOwner } = {}) {
					return clear(channel, scheduleName(name), owner);
				},
				async stage(id, owner, method, args) {
					const isClear = method === 'clearSchedule';
					if (!Array.isArray(args) || (isClear ? args.length !== 1 : method !== 'schedule' || args.length !== 2))
						throw new TypeError('Invalid staged schedule operation.');
					const record = isClear ? { name: scheduleName(args[0]), clear: true } : { ...scheduleOptions(args[1]), owner };
					if (committed.get(owner)?.id === id || aborted.get(owner) === id) return false;
					if (!transactions.has(id)) transactions.set(id, { owner, records: new Map() });
					const transaction = transactions.get(id);
					if (transaction.owner !== owner) throw new TypeError('Schedule transaction owner mismatch.');
					if (!transaction.records.has(channel)) transaction.records.set(channel, []);
					const records = transaction.records.get(channel);
					records.push(record);
					if (isClear) return true;
					const isCurrent = () => transactions.get(id) === transaction && transaction.records.get(channel) === records;
					try {
						record.playback = await prepareRecord(channel, args[0], record);
					} catch (error) {
						if (!isCurrent()) return false;
						throw error;
					}
					return isCurrent() ? receipt(record, { staged: true }) : false;
				},
				commit, abort, cancelOwner,
			};
		},
		stop(name) {
			let end;
			for (const [key, channel] of channels) {
				if (name !== undefined && name !== key) continue;
				channel.pending = null;
				for (const transaction of transactions.values()) transaction.records.delete(channel);
				const stopped = stopActive(channel);
				if (stopped !== undefined) end = Math.max(end ?? stopped, stopped);
			}
			return end;
		},
	};
}
