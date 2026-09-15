# `@napi-rs/wasm-runtime` file-system prebundle

`@napi-rs/wasm-runtime@1.1.6` publishes `dist/fs.js` as one prebundled file.
The package tarball does not expose its inputs as separate npm packages. The
editor therefore ships the [exact published prebundle](PREBUNDLED_SOURCE.js),
including its inline source map and source contents, beside this notice.

The npm release records git commit
`b77119e711704cc453949e056b45a4996ea0386c`. Its source map and the lockfile at
that commit identify these 48 bundled components:

| Licence | Components |
| --- | --- |
| 0BSD | `tslib@2.8.1` |
| BSD-3-Clause | `ieee754@1.2.1`, `qs@6.15.2` |
| Apache-2.0 | `@jsonjoy.com/fs-node-builtins@4.57.6`, `@jsonjoy.com/fs-core@4.57.6`, `@jsonjoy.com/fs-node-utils@4.57.6`, `@jsonjoy.com/fs-node@4.57.6`, `@jsonjoy.com/fs-print@4.57.6`, `@jsonjoy.com/fs-snapshot@4.57.6`, `memfs@4.57.6`, `tree-dump@1.1.0`, `@jsonjoy.com/buffers@17.67.0`, `@jsonjoy.com/json-pack@17.67.0`, `@jsonjoy.com/base64@17.67.0`, `glob-to-regex.js@1.2.0` |
| MIT | `process@0.11.10`, `path-browserify@1.0.1`, `base64-js@1.5.1`, `buffer@6.0.3`, `thingies@2.6.0`, `punycode@1.4.1`, `es-errors@1.3.0`, `object-inspect@1.13.4`, `side-channel-list@1.0.1`, `es-object-atoms@1.1.2`, `math-intrinsics@1.1.0`, `gopd@1.2.0`, `es-define-property@1.0.1`, `has-symbols@1.1.0`, `get-proto@1.0.1`, `function-bind@1.1.2`, `call-bind-apply-helpers@1.0.2`, `dunder-proto@1.0.1`, `async-function@1.0.0`, `generator-function@2.0.1`, `async-generator-function@1.0.0`, `hasown@2.0.4`, `get-intrinsic@1.3.1`, `call-bound@1.0.4`, `side-channel-map@1.0.1`, `side-channel-weakmap@1.0.2`, `side-channel@1.1.0`, `url@0.11.4`, `readable-stream@4.7.0`, `abort-controller@3.0.0`, `events@3.3.0`, `safe-buffer@5.2.1`, `string_decoder@1.3.0` |

## Notices removed or shortened by minification

Bun removes ordinary comments and keeps only short `/*! ... */` comments.
The full upstream terms for every notice that this changes are copied here:

- Microsoft TypeScript helpers: [0BSD terms](prebundled/tslib/2.8.1/LICENSE.txt)
  and [copyright notice](prebundled/tslib/2.8.1/CopyrightNotice.txt).
- `ieee754`: [BSD-3-Clause terms](prebundled/ieee754/1.2.1/LICENSE).
- Browser `buffer`: [MIT terms](prebundled/buffer/6.0.3/LICENSE).
- Punycode: [MIT terms](prebundled/punycode/1.4.1/LICENSE-MIT.txt).
- Joyent and Node URL code: [MIT terms](prebundled/url/0.11.4/LICENSE) and
  the [exact stripped notice](prebundled/borrowed/NODE-JOYENT-MIT.txt).
- `safe-buffer`: [MIT terms](prebundled/safe-buffer/5.2.1/LICENSE).
- Code borrowed from `cbor-x`: [Kris Zyp MIT terms](prebundled/borrowed/cbor-x-MIT.txt).

The source map also records code adapted from lodash and stream code ported
from Mathias Buus's `pump`. Their
[lodash terms](prebundled/borrowed/lodash-4.17.15-LICENSE),
[pump terms](prebundled/borrowed/pump-MIT.txt), and
[source attributions](prebundled/borrowed/readable-stream-attributions.txt)
are copied as well.

The source tree also vendors exact BSD and Apache terms for the main
source-map components, including [`qs`](prebundled/qs/6.15.2/LICENSE.md),
[`memfs`](prebundled/memfs/4.57.6/LICENSE), and the `@jsonjoy.com` modules.
