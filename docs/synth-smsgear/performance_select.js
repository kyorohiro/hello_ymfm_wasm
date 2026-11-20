// SPDX-License-Identifier: BSD-3-Clause
// Keep pointer-opened sound menus in the page so native popups cannot consume
// performance key-up events. Native selects remain available for keyboard access.
export function setupPerformanceSelects(selects) {
	const doc = selects[0].ownerDocument;
	let menu = null,
		owner = null;
	function close() {
		if (owner) owner.setAttribute("aria-expanded", "false");
		menu?.remove();
		menu = owner = null;
	}
	function open(select) {
		const same = owner === select;
		close();
		if (same || select.disabled) return;
		owner = select;
		select.blur();
		select.setAttribute("aria-expanded", "true");
		menu = doc.createElement("div");
		menu.className = "performance-select-menu";
		menu.setAttribute("role", "group");
		menu.setAttribute(
			"aria-label",
			select.labels?.[0]?.textContent?.trim() || select.id,
		);
		for (const option of select.options) {
			const button = doc.createElement("button");
			button.type = "button";
			button.textContent = option.textContent;
			button.disabled = option.disabled;
			button.dataset.value = option.value;
			button.setAttribute("aria-pressed", String(option.selected));
			button.addEventListener("pointerdown", (event) =>
				event.preventDefault(),
			);
			button.addEventListener("click", () => {
				const changed = select.value !== option.value;
				select.value = option.value;
				close();
				select.blur();
				if (changed)
					select.dispatchEvent(
						new Event("change", { bubbles: true }),
					);
			});
			menu.append(button);
		}
		doc.body.append(menu);
		const rect = select.getBoundingClientRect();
		menu.style.width =
			Math.min(Math.max(rect.width, 160), innerWidth - 16) + "px";
		menu.style.left =
			Math.max(
				8,
				Math.min(rect.left, innerWidth - menu.offsetWidth - 8),
			) + "px";
		menu.style.maxHeight = Math.min(280, innerHeight - 16) + "px";
		menu.style.top =
			Math.max(
				8,
				Math.min(rect.bottom + 3, innerHeight - menu.offsetHeight - 8),
			) + "px";
	}
	for (const select of selects) {
		select.addEventListener("pointerdown", (event) => {
			if (event.button !== 0 || select.disabled) return;
			event.preventDefault();
			open(select);
		});
		select.addEventListener("change", () => {
			close();
			select.blur();
		});
	}
	doc.addEventListener(
		"pointerdown",
		(event) => {
			if (menu && !menu.contains(event.target) && event.target !== owner)
				close();
		},
		true,
	);
	doc.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && menu) {
			event.preventDefault();
			close();
		}
	});
	window.addEventListener("resize", close);
	window.addEventListener("blur", close);
}
