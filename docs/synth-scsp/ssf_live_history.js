// SPDX-License-Identifier: BSD-3-Clause
// Retain a small native-state window around the samples reaching the output.
export function createScspSsfLiveHistory(limit = 16) {
	const snapshots = [];
	function push(snapshot) {
		if (!snapshot || !Number.isSafeInteger(snapshot.frame) || snapshot.frame < 0) return;
		const previous = snapshots.at(-1);
		if (previous && snapshot.frame <= previous.frame) return;
		snapshots.push(snapshot);
		if (snapshots.length > limit) snapshots.splice(0, snapshots.length - limit);
	}
	function at(frame) {
		for (let index = snapshots.length - 1; index >= 0; index--)
			if (snapshots[index].frame <= frame) return snapshots[index];
		return null;
	}
	function prune(frame) {
		// Keep the closest past state and all bounded lookahead states.
		while (snapshots.length > 1 && snapshots[1].frame <= frame) snapshots.shift();
	}
	return {
		push,
		at,
		prune,
		clear() {
			snapshots.length = 0;
		},
		get size() {
			return snapshots.length;
		},
	};
}
