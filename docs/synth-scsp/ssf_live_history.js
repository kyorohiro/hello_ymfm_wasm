// SPDX-License-Identifier: BSD-3-Clause
// Retain a small native-state window around the samples reaching the output.
export function createScspSsfLiveHistory(limit = 16) {
	const snapshots = [];
	const maxBytes = 8 * 1024 * 1024;
	let bytes = 0;
	const bufferBytes = value => ArrayBuffer.isView(value) ? value.byteLength : 0;
	const sizeOf = snapshot => bufferBytes(snapshot.ram)
		+ (snapshot.slots ?? []).reduce((total, slot) => total + bufferBytes(slot.registers), 0)
		+ ['program', 'coefficients', 'addresses', 'outputs'].reduce((total, key) => total + bufferBytes(snapshot.dsp?.[key]), 0);
	function shift() {bytes -= snapshots.shift().bytes;}
	function push(snapshot) {
		if (!snapshot || !Number.isSafeInteger(snapshot.frame) || snapshot.frame < 0) return;
		const previous = snapshots.at(-1)?.snapshot;
		if (previous && snapshot.frame <= previous.frame) return;
		const size = sizeOf(snapshot);
		if (size > maxBytes) return;
		snapshots.push({snapshot, bytes: size});bytes += size;
		while (snapshots.length > limit || bytes > maxBytes) shift();
	}
	function at(frame) {
		for (let index = snapshots.length - 1; index >= 0; index--)
			if (snapshots[index].snapshot.frame <= frame) return snapshots[index].snapshot;
		return null;
	}
	function prune(frame) {
		// Keep the closest past state and all bounded lookahead states.
		while (snapshots.length > 1 && snapshots[1].snapshot.frame <= frame) shift();
	}
	return {
		push,
		at,
		prune,
		clear() {
			snapshots.length = 0;
			bytes = 0;
		},
		get size() {
			return snapshots.length;
		},
		get bytes() {return bytes;},
	};
}
