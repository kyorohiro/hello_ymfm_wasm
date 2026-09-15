# Third-party notices

This file lists the code and data that this project builds into its Wasm and
asset outputs. The license names below are short summaries. The copied
upstream terms in [`third-party/licenses`](third-party/licenses) control.

The source repo does not contain the fetched upstream source trees.
[`flake.lock`](flake.lock) pins them, and the files under [`nix`](nix) hold
the build rules and local patches.

## Static Wasm link

`lilypond.wasm` contains modified LilyPond code and the static libraries
listed here.

| Part | Pinned version | License | Copied terms | Upstream |
| --- | --- | --- | --- | --- |
| LilyPond | 2.27.2, commit `9c1e4dc760f6de0e4fdb762f6d5b124baa0f3a17` | GPL-3.0-or-later | [`lilypond`](third-party/licenses/lilypond) | [LilyPond](https://gitlab.com/lilypond/lilypond) |
| Boehm GC | 8.2.12 | Boehm-GC | [`boehm-gc`](third-party/licenses/boehm-gc) | [Boehm GC](https://github.com/ivmai/bdwgc) |
| Expat | 2.8.2 | MIT | [`expat`](third-party/licenses/expat) | [Expat](https://libexpat.github.io/) |
| Fontconfig | 2.18.1 | LicenseRef-Fontconfig | [`fontconfig`](third-party/licenses/fontconfig) | [Fontconfig](https://www.freedesktop.org/wiki/Software/fontconfig/) |
| FreeType | 2.14.3 | FTL OR GPL-2.0-or-later | [`freetype`](third-party/licenses/freetype) | [FreeType](https://freetype.org/) |
| FriBidi | 1.0.16 | LGPL-2.1-or-later | [`fribidi`](third-party/licenses/fribidi) | [FriBidi](https://github.com/fribidi/fribidi) |
| GLib, GObject, and GIO | 2.88.1 | LGPL-2.1-or-later | [`glib`](third-party/licenses/glib) | [GLib](https://gitlab.gnome.org/GNOME/glib) |
| GMP | 6.3.0 | LGPL-3.0-or-later OR GPL-2.0-or-later | [`gmp`](third-party/licenses/gmp) | [GMP](https://gmplib.org/) |
| GNU Guile | 3.0.11 | LGPL-3.0-or-later | [`guile`](third-party/licenses/guile) | [Guile](https://www.gnu.org/software/guile/) |
| HarfBuzz | 13.2.1 | MIT | [`harfbuzz`](third-party/licenses/harfbuzz) | [HarfBuzz](https://harfbuzz.github.io/) |
| libffi | 3.7.0 | MIT | [`libffi`](third-party/licenses/libffi) | [libffi](https://sourceware.org/libffi/) |
| libpng | 1.6.58 | libpng-2.0 | [`libpng`](third-party/licenses/libpng) | [libpng](http://www.libpng.org/pub/png/libpng.html) |
| libunistring | 1.4.2 | LGPL-3.0-or-later OR GPL-2.0-or-later | [`libunistring`](third-party/licenses/libunistring) | [libunistring](https://www.gnu.org/software/libunistring/) |
| Pango | 1.57.1 | LGPL-2.0-or-later | [`pango`](third-party/licenses/pango) | [Pango](https://www.pango.org/) |
| PCRE2 | 10.47 | BSD-3-Clause WITH PCRE2-exception | [`pcre2`](third-party/licenses/pcre2) | [PCRE2](https://www.pcre.org/) |
| zlib | 1.3.2 | Zlib | [`zlib`](third-party/licenses/zlib) | [zlib](https://zlib.net/) |
| wasi-libc | 32 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT, with bundled code under its listed terms | [`wasi-libc`](third-party/licenses/wasi-libc) | [wasi-libc](https://github.com/WebAssembly/wasi-libc) |
| compiler-rt builtins | 21.1.8 | Apache-2.0 WITH LLVM-exception | [`compiler-rt`](third-party/licenses/compiler-rt) | [LLVM](https://github.com/llvm/llvm-project) |
| libc++ and libc++abi | 21.1.8 | Apache-2.0 WITH LLVM-exception | [`libcxx`](third-party/licenses/libcxx) | [LLVM](https://github.com/llvm/llvm-project) |

For dual-licensed libraries, this build uses an option that can be combined
with GPL-3.0-or-later. The full upstream files record all choices.

## Runtime assets

The asset output has mixed terms and must keep them separate.

| Part | Pinned version | License | Copied terms | Notes |
| --- | --- | --- | --- | --- |
| LilyPond Scheme and input data | same pinned LilyPond commit | GPL-3.0-or-later, with file-level exceptions | [`lilypond`](third-party/licenses/lilypond) | `ly/articulate.ly` is GPL-3.0-only. |
| Emmentaler and Feta fonts | same pinned LilyPond commit | (GPL-3.0-or-later WITH the LilyPond font exception) OR OFL-1.1 | [`emmentaler`](third-party/licenses/emmentaler) | `Emmentaler` and `Feta` are reserved font names under the OFL choice. |
| URW Base35 fonts | tag `20200910` | AGPL-3.0-only WITH the URW document font exception | [`urw-base35`](third-party/licenses/urw-base35) | The exception names PostScript and PDF documents. It does not grant a broad SVG or web-font exception. |
| DejaVu fonts | 2.37 | LicenseRef-DejaVu | [`dejavu`](third-party/licenses/dejavu) | The file includes the Bitstream Vera, Arev, and DejaVu terms. |

## Local changes

These paths change upstream code for WASI or for the SVG-only build:

- [`nix/patches`](nix/patches): Boehm GC, GMP, libffi, and libunistring.
- [`nix/guile/patches`](nix/guile/patches): Guile.
- [`nix/fontconfig/patches`](nix/fontconfig/patches): Fontconfig.
- [`nix/glib/patches`](nix/glib/patches): GLib and GObject.
- [`nix/harfbuzz/patches`](nix/harfbuzz/patches): HarfBuzz.
- [`nix/pango/patches`](nix/pango/patches): Pango.
- [`nix/lilypond/patches`](nix/lilypond/patches): LilyPond.
- [`nix/lilypond/assets/patches`](nix/lilypond/assets/patches): LilyPond assets.

The top-level GPL-3.0-or-later grant covers work owned by this project's
author. It does not replace the rights or terms for upstream code shown in a
patch.

## Binary distribution

Anyone who distributes the built Wasm, static archives, assets, or a public
Nix cache must check the terms for the files they serve. A binary release
should include this notice and the full license tree.

A release of `lilypond.wasm` must also provide the complete matching source
needed to build it. That source includes the pinned LilyPond, library, and
toolchain runtime sources, this repo, all patches, and the build and link
scripts. Put a complete source archive beside the binary so the release does
not depend only on upstream hosts.

The final link uses LGPL libraries statically. Recipients must have the
source and build or object material needed to relink the program with changed
versions of those libraries.

This notice records the current build. Recheck it when a source pin, link
input, font, or packaged file changes.
