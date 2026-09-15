# PDFKit standalone browser bundle

The editor imports `pdfkit@0.19.1` through its published
`js/pdfkit.standalone.js` file. That Browserify file contains PDFKit, its
run-time packages, browser shims, standard PDF font metrics, and their source
notices. Bun reports the file as one package input.

The built editor therefore keeps the exact published file as
[`PREBUNDLED_SOURCE.js`](PREBUNDLED_SOURCE.js). Copyright and licence notices
inside that source remain intact. PDFKit’s own MIT terms are in
[`LICENSE`](LICENSE), and the package metadata records the pinned version and
upstream source.

During the build, this record expands into a module-name list read from the
Browserify map, the locked top-level package list, and copied Apache-2.0,
BSD-3-Clause, 0BSD, ISC, MIT, and zlib terms. The module map does not record
nested package versions, so the record does not claim that it does. The exact
published source controls.
