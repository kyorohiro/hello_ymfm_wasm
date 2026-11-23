// SPDX-License-Identifier: BSD-3-Clause
const TICKS_PER_SECOND = 44100;
const STOP_ALL = 0x580;
const EFFECT_MODES = ['off', 'sweep', 'modulation'];

export function createVgmTransport({ sampleRate, reset, restore, write, renderFrames, setMask, readChannel, onState }) {
	const reportInterval = Math.ceil(sampleRate / 30);
	let current = null;

	// Keep a single absolute frame clock across loop iterations. Each command
	// lands on the nearest host sample, including at fractional sample rates.
	const frameAt = (song, tick) => Math.round((song.originTicks + tick) * sampleRate / TICKS_PER_SECOND);

	function notify(song, positionTicks) {
		onState({
			id: song.id,
			state: song.state,
			positionTicks,
			channels: Array.from({ length: 6 }, (_, channel) => {
				const word = readChannel(channel);
				return {
					active: Boolean(word & 0x100), left: (word >> 4) & 15, right: word & 15,
					mode: EFFECT_MODES[(word >> 9) & 3] ?? 'off',
				};
			}),
		});
		song.reportAt = song.frame + reportInterval;
	}

	function position(song) {
		return Math.max(song.startTick,
			Math.min(song.durationTicks, Math.round(song.frame * TICKS_PER_SECOND / sampleRate - song.originTicks)));
	}

	function applyDueWrites(song) {
		const { writes } = song;
		while (song.cursor < writes.length && frameAt(song, writes[song.cursor]) <= song.frame) {
			write(writes[song.cursor + 1], writes[song.cursor + 2]);
			song.cursor += 3;
		}
	}

	function rewind(song) {
		song.startTick = song.loopTick ?? 0;
		song.originTicks += song.durationTicks - song.startTick;
		song.cursor = song.loopTick === null ? 0 : song.loopIndex * 3;
		// A native VGM loop carries the chip state across the jump. A file with
		// no loop point restarts as it did at the beginning of the first pass.
		if (song.loopTick === null) {
			reset();
			setMask(song.mask);
		}
	}

	function finish(song) {
		write(STOP_ALL, 1);
		song.state = 'ended';
		song.writes = null;
		notify(song, song.durationTicks);
	}

	return {
		get ownsOutput() { return current?.state === 'playing' || current?.state === 'paused'; },
		get outputId() { return this.ownsOutput ? current.id : null; },
		isPlaying(id) { return current?.state === 'playing' && current.id === id; },
		isPaused(id) { return current?.id === id && current.state === 'paused'; },
		play({ id, plan, loop, mask, checkpoint, paused = false }) {
			current = {
				...plan, id, loop, mask, state: paused ? 'paused' : 'playing',
				cursor: checkpoint?.cursor ?? 0, frame: checkpoint?.frame ?? 0,
				originTicks: 0, startTick: 0, reportAt: 0,
			};
			if (checkpoint) restore(checkpoint.bytes);
			else reset();
			setMask(mask);
			applyDueWrites(current);
			const tick = checkpoint?.tick ?? 0;
			if (tick === current.durationTicks && (paused || !loop)) finish(current);
			else notify(current, tick);
		},
		pause(id, paused) {
			if (current?.id !== id || !this.ownsOutput) return;
			current.state = paused ? 'paused' : 'playing';
			notify(current, position(current));
		},
		stop(id) {
			if (current?.id !== id) return;
			reset();
			current.state = 'stopped';
			notify(current, 0);
			current = null;
		},
		setLoop(id, loop) {
			if (current?.id === id) current.loop = loop;
		},
		setMask(id, mask) {
			if (current?.id !== id) return;
			current.mask = mask;
			setMask(mask);
		},
		render(frames) {
			const song = current;
			if (song?.state !== 'playing') return 0;
			let rendered = 0;
			for (;;) {
				applyDueWrites(song);
				const end = frameAt(song, song.durationTicks);
				if (song.frame === end) {
					if (song.loop) {
						rewind(song);
						continue;
					}
					finish(song);
					return rendered;
				}
				if (rendered === frames) break;
				const next = song.cursor < song.writes.length ? frameAt(song, song.writes[song.cursor]) : end;
				const count = Math.min(frames - rendered, end - song.frame, next - song.frame);
				renderFrames(rendered, count);
				song.frame += count;
				rendered += count;
			}
			if (song.frame >= song.reportAt) notify(song, position(song));
			return rendered;
		},
	};
}
