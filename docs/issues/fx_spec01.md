Title: Add `parallel()` / `branch()` FX Routing Support

Goal

Add a small FX routing abstraction that allows multiple FX chains to receive the same input in parallel and then be mixed back together.

Keep the API minimal.

Do not redesign the entire FX system.

Existing serial FX behavior must continue to work unchanged.

Example target usage:

```js
fx(
  parallel(
    chorus(),
    reverb(),
  ),
)