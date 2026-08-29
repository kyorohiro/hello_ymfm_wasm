Add basic safety guards for external Playground source code

Add a small safety layer around JavaScript source loaded into Tetorica FM2612 Playground.

Goal

The Playground can receive JavaScript source through URL parameters such as:

?src=<base64>

This is useful for sharing examples, tutorials, research notes, and external links.

However, source code supplied by an external URL must not silently perform network communication or automatically execute without the user seeing it first.

This task is NOT intended to build a complete secure JavaScript sandbox.

Keep the implementation small and focused.

Required behavior

1. Never auto-run externally supplied source

When source code is loaded from:

src=

decode it and place it in the editor as usual.

Do NOT automatically execute it.

The user must explicitly press Run.

Existing local/editor workflows should continue to work normally.

2. Block common network APIs during Playground code execution

User code executed by the Playground must not be able to make network requests through common browser APIs.

Block at least:

fetch
XMLHttpRequest
WebSocket
EventSource
navigator.sendBeacon

Attempts to use these APIs should fail clearly and safely.

For example, throw an error such as:

Network access is disabled in Tetorica FM2612 Playground.

The exact wording may follow the existing error UI/style.

3. Avoid permanent mutation of the host page

Do not permanently replace browser globals for the entire Tetorica page if this can be avoided.

Network blocking should apply specifically while Playground user code is executing.

Restore any temporarily replaced globals after execution completes or fails.

Use try/finally where appropriate.

4. Block obvious navigation helpers if user code has direct window access

If the current execution environment exposes window directly, also guard obvious navigation helpers such as:

window.open

and prevent Playground code from intentionally navigating the current page if there is a small, reliable way to do so.

Do not add a large navigation interception framework.

If current architecture makes this difficult, document the limitation instead of introducing broad invasive changes.

Important limitations

This is only a basic safety guard.

Do NOT claim that arbitrary JavaScript is fully sandboxed.

Code running in the same JavaScript realm may still be able to:

* consume CPU
* allocate large amounts of memory
* access DOM APIs
* inspect globals
* attempt unusual escape paths

Do not attempt to solve all of these in this task.

In particular, do NOT redesign the Playground around Worker or sandboxed iframe execution as part of this change.

That can be considered separately later.

Error handling

Blocked network access should:

* fail immediately
* produce a readable Playground error
* not crash the rest of the application
* not leave modified browser globals behind

Example:

await fetch("https://example.com");

should fail with a clear network-disabled error.

The same applies to:

new XMLHttpRequest();
new WebSocket("wss://example.com");
new EventSource("https://example.com/events");
navigator.sendBeacon(...);

Compatibility

Do not break the existing Playground APIs, including:

fm
fx
liveLoop
livePrepare
play
sleep
beat
setBpm
setMasterVolume

Do not change unrelated audio behavior.

Existing source loading through:

src=
ex=

must continue to work.

The only behavioral change for externally loaded src= is:

load into editor
→ wait for explicit Run
→ execute with network guards

Implementation preference

Prefer one small execution wrapper around the existing user-code execution path.

Conceptually:

async function runUserCode(...) {
  const restore = installPlaygroundGuards();
  try {
    await executeUserCode(...);
  } finally {
    restore();
  }
}

Do not duplicate guards throughout unrelated modules.

If source is already executed through one central function, place the guard there.

Tests

Add tests covering at least:

* external src= is loaded but not automatically executed
* normal user code still runs after pressing Run
* fetch is blocked
* XMLHttpRequest is blocked
* WebSocket is blocked
* EventSource is blocked
* navigator.sendBeacon is blocked
* blocked APIs are restored after user-code execution finishes
* blocked APIs are restored after user-code execution throws
* existing Playground APIs still work

Documentation

Add a short note to the Playground documentation explaining:

* shared URLs may contain JavaScript source
* shared source is not executed automatically
* Playground execution disables common network APIs
* this is a safety guard, not a complete security sandbox

Keep the wording factual and concise.

Non-goals

Do NOT add:

* Worker-based execution
* iframe sandboxing
* CSP redesign
* a permissions UI
* network allowlists
* domain-specific permissions
* package/module loading
* external library loading
* code signing
* trust scores
* user accounts

Those are outside this task.