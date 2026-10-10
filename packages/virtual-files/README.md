# tetorica-virtual-files

Memory filesystem and a small extensible shell for browser and Node.js tools.
The package has no sound-chip, DOM, storage or network dependency. Requires Node.js
22 or later, or a modern browser with ES modules.

```sh
npm install tetorica-virtual-files
```

Build its distribution from source with `npm run build:virtual-files` in the repository root.

```javascript
import {createVirtualFileSystem, createShell} from 'tetorica-virtual-files';

const fs = createVirtualFileSystem([{path:'/index.js', data:'export const value = 1;'}]);
fs.mkdir('/empty');
fs.writeBinary('/samples/data.bin', new Uint8Array([0, 255]));

const shell = createShell({fs});
await shell.execute('cd /samples');
console.log(await shell.execute('ls'));
await shell.execute(`write '/lib/notes.js' 'export const notes = [60, 64, 67];'`);

const snapshot = fs.snapshot();
fs.restore(snapshot);
```

`list()` and `has()` refer to files. Use `stat()`, `readdir()` and
`listDirectories()` for directories, including `/` and empty directories.
Writes create missing parent directories. `mkdir` without `recursive:true`
requires an existing parent. Files cannot replace directories or occupy their ancestors.
Reads copy binary data. Whole-project replacement, snapshot restoration and
copy/move validate the operation before committing and emit one change notification.

`resolvePath(path, cwd)` resolves relative to a directory;
`normalizeVirtualPath(path, baseFile)` resolves relative to a file.
Paths cannot traverse above `/`. Snapshots contain text, `Uint8Array` data and
directories and are suitable for structured cloning in IndexedDB. JSON serialization
requires a separate binary encoding. Persistence is supplied by the host application.

The shell supports `pwd`, `ls`, `cd`, `cat`, `mkdir [-p]`, `cp`, `mv`, `rm [-r]`,
`touch`, `write PATH TEXT`, `echo`, `help`, `find`, `rg`, `read` and `edit`. `cp` and `mv` accept files or entire directories.
It parses quotes and escapes, runs requests in order, and returns
`{code, stdout, stderr}`. Command chaining, expansions, host commands and JavaScript execution are
outside the independent core; host commands can be registered separately.

```javascript
shell.register('count', ({fs, signal}) => {
  signal?.throwIfAborted();
  return `${fs.list().length} files\n`;
});
await shell.execute('count', {signal: new AbortController().signal});
```

Custom commands receive `fs`, `args`, `cwd`, `resolve`, `signal`, `stdin`,
`execute` and `assertActive`. Use the context's `execute` for nested commands:
it dispatches directly rather than waiting behind the enclosing command.
`shell.execute(['write', '/name with spaces.txt', 'text'])` also accepts an
argument array without shell quoting. An aborted command returns code 130 and
releases the queue. Host commands must check `assertActive()` before delayed
mutations; aborting cannot forcibly stop arbitrary command functions.
An `authorize(operation, paths)` callback can reject built-in file mutations.
Custom commands must enforce their own host policies. This library is not a
security sandbox for arbitrary JavaScript.

Git and JavaScript formatting/checking tools are planned extensions. There is no
Git implementation, remote access, filesystem mount or `tetorica-fm2612` re-export yet.

## Agent-friendly inspection and editing (working tree)

These additions are available in the repository build and Playground shell.
Use `help --json` to discover commands and their usage; `help read` describes a
single command. The commands also work through `shell.execute()` from
`tetorica:shell` scripts. A host MCP adapter can pass an argument array directly
and return the existing `{code, stdout, stderr}` result.

| Command | Use |
|---|---|
| `find [PATH] [-name GLOB] [-type f or -type d]` | Recursive, sorted path inventory; `*` and `?` match basenames, including dotfiles |
| `rg [-n] [-F] [-i] [-l] LITERAL [PATH]` | Literal text search with absolute paths, 1-based lines and columns; `-i` ignores case, `-l` returns file paths |
| `read [--start N] [--end N] [--max-chars N] PATH` | Numbered, inclusive line range; text files only |
| `edit [--revision N] [--expect N] [--dry-run] PATH OLD_TEXT NEW_TEXT` | Exact, nonoverlapping replacement, defaulting to exactly one occurrence |

All four accept `--json`. Put `--` before positional arguments beginning with
`-`. There are no regex patterns or implicit glob expansions in `rg`; the
literal `-F` flag is accepted for familiarity. Binary files are skipped by search
and rejected by `read` / `edit`. No matches give `rg` exit code 1 with empty
stderr; invalid input gives code 1 and an explanatory stderr.

`find` and `rg` default to 100 results, accept `--limit 1..1000` and
`--offset N`, and limit result content to about 16,000 characters per response.
JSON includes `entries`, `total`, `offset`, `nextOffset` and `truncated`; follow
`nextOffset` while the files remain unchanged. Search keeps only the requested
page of matches in memory. Each matching line has a maximum 1,000-character
excerpt around the first match, with `column`, `snippetStartColumn` and
`textTruncated` indicating its location. Large searches periodically yield and
honor the command's abort signal.

`read` defaults to lines 1..200 and a 16,000-character content budget.
`--max-chars` accepts 1..64000. Its JSON includes `path`, `revision`, `lines` (line / text),
`totalLines`, `nextLine` and `truncated`. When a single line is clipped,
`nextLine` refers to that same line; increase the budget or use `cat` to read it
in full. `cat` retains its existing unbounded behavior.

```javascript
// Use argument arrays to preserve multiline text, spaces and shell characters.
await shell.execute(['find', '--json', '-name', '*.js', '/']);
await shell.execute(['rg', '--json', 'export const', '/']);
await shell.execute(['read', '--json', '--start', '1', '--end', '20', '/index.js']);
await shell.execute(['edit', '--dry-run', '--json', '/index.js', 'value = 1', 'value = 2']);
const edited = await shell.execute(['edit', '--json', '/index.js', 'value = 1', 'value = 2']);
if (edited.code) throw new Error(edited.stderr); // Re-read if the text changed.
```

A dry run validates the match count and returns a summary without writing.
Zero or ambiguous matches fail without mutation; intentional multiple matches
require `--expect N` (1..1000). Empty old text is rejected. Successful edits
preserve the rest of the file, emit one filesystem change, and call the host's
`authorize('edit', [absolutePath])` policy. Guarded Playground script sessions
still enforce their project, cancellation and human-edit checks.

## File revisions (working tree)

`fs.get(path)`, `fs.list()` and `fs.stat(path)` include `revision`.
`read --json PATH` and `find --json` expose it to shell clients.
`fs.getRevision(path)` returns the last revision even after deletion; a path
that has never existed returns 0. For stdin, `read --json -` reports `revision: null`.

Revisions advance on content/type or path existence changes, including binary
writes, moves, deletions, replacement and restore. Writing identical data does
not advance the revision. Unchanged files retain their revisions. Deleted paths
retain a tombstone, so deleting and recreating the same content, or changing it
and changing it back, still invalidates an older revision. Directory revisions
track their own existence, not their children's contents.

```javascript
const read = await shell.execute(['read', '--json', '/index.js']);
if (read.code) throw new Error(read.stderr);
const {revision} = JSON.parse(read.stdout);
const result = await shell.execute([
  'edit', '--json', '--revision', String(revision),
  '/index.js', 'value = 1', 'value = 2',
]);
if (result.code) throw new Error(result.stderr); // Re-read before retrying.
```

`edit --revision N` checks the whole file, even when `OLD_TEXT` still matches.
Without this optional flag, existing exact-match editing remains available.
`edit --json` returns `beforeRevision` and the resulting `revision`; a dry run
checks the same precondition without changing either file or revision.

Every patch operation optionally accepts `expectedRevision: N`. All operations
for the same path compare against the live revision **before the patch**, not
against intermediate draft revisions. A single stale revision rejects the entire
patch, including dry runs. Patch reports include `beforeRevision` and the final
`revision` per operation. A guarded creation can use 0 for a never-present path,
or `fs.getRevision(path)` for a deleted path.

Direct `fs.writeFile`, `fs.writeText` and `fs.writeBinary` accept a third argument
`{expectedRevision: N}` for the same check. Playground's asynchronous script API
exposes these options and `getRevision`; script sessions and output redirection
also use revisions to detect subsequent edits that return to the same content.

Revisions belong to one filesystem instance and are not timestamps or persistent
IDs. Discard cached revisions when a project reloads. Version-1 snapshots remain
content-only: restoring one creates new live revisions for changed paths and
never resets the counters. Explicit snapshot undo is still pending.

## Atomic patches and snapshot diffs (working tree)

`patch [--json] [--dry-run] PATCH_FILE` reads a JSON array of text edits.
`patch -` reads the JSON array from `execute`'s `stdin` option. Paths are resolved
relative to the shell cwd. A document may contain up to 1,000 edits and the shell
accepts up to 1,000,000 characters. Each edit has one of these shapes:

```json
[
  {"path":"/index.js","oldText":"value = 1","newText":"value = 2"},
  {"type":"create","path":"/lib/new.js","text":"export const enabled = true;\n"},
  {"type":"delete","path":"/obsolete.js","expectedText":"exact previous contents"}
]
```

Replacements default to exactly one match; `expect` explicitly permits more.
Edits are checked in order against a temporary filesystem, so successive edits
can target the same file. Creates require a missing path. Deletes require the
complete expected text. Binary targets, unknown fields, invalid parent paths and
stale or ambiguous matches fail before the live filesystem changes.

All operations commit together with one change notification. Host policies run
before commit: `authorize('patch', paths)` checks all targets, and each deletion
also calls `authorize('rm', [path])`. A dry run performs validation without writing.
JSON output reports `applied` and `changes` (path, type, matches).
The exported `applyTextPatch(fs, edits, options)` API uses the same implementation;
its optional `assertActive` callback can enforce a host command's lifetime.

```javascript
fs.writeText('/changes.json', JSON.stringify([
  {path: '/index.js', oldText: 'value = 1', newText: 'value = 2'}
]));
await shell.execute('snapshot before');
await shell.execute('patch --dry-run --json /changes.json');
await shell.execute('patch --json /changes.json');
console.log((await shell.execute('diff --json before /index.js')).stdout);
```

`snapshot [NAME]` saves a baseline in shell memory (default `baseline`).
`snapshot --list` lists names; `snapshot --remove NAME` removes one. Up to eight
baselines are kept, and saving an existing name replaces that baseline.
`diff [NAME] [PATH]` compares a baseline with current files and empty directories.
Both snapshots and diffs accept `--json`; diff also accepts `--offset` / `--limit`
with the same paging rules as `find`. Text changes include a bounded `hunk` and
`hunkTruncated`; binary changes report metadata. The exported
`diffSnapshots(before, after, {path})` API also accepts external filesystem snapshots.

Baselines remain in memory through ordinary edits. Use `shell.clearSnapshots()`
when replacing a host project; `dispose()` also clears them. Playground clears
baselines on project invalidation. Baselines are not part of autosave or Cassette ZIPs.
Diff hunks are review excerpts, with changed middle sections and surrounding
context; they may be truncated and are not patch input.

## Playground JavaScript syntax check

The Playground host registers `check [--json] [PATH]` using Monaco's JavaScript
parser. With no path it checks JavaScript files beneath cwd; a directory checks
its `.js`, `.mjs` and `.cjs` files recursively. A file checks that single text file.
Project code is parsed without execution. Static imports and exports can be checked.
This host command is discoverable through `help --json`; it is separate from the
independent filesystem package and needs Monaco to be available.

JSON output contains `files`, `diagnostics`, `total` and `truncated`. Diagnostics
have path, 1-based line / column, code, severity and message. Syntax errors return
exit code 1. Output is limited to 40 diagnostics with short messages; inspect a
narrower path for remaining diagnostics. This checks syntax, not runtime behavior
or imported-module availability.

## Playground structured script results

`js --json PATH [ARGS...]` executes a shell script and returns a JSON report in
stdout. The command still returns code 0 for success and code 1 for failure.
Plain `js PATH` retains streaming text output. `result --json [RUN_ID]` retrieves
an already completed run, defaulting to the most recently completed one.
This is a Playground host feature discoverable through `help --json`.

Reports contain `id`, `path`, `code`, `status` (`completed`, `failed`, `cancelled`),
`durationMs`, `stdout`, `stderr`, `console`, `error` and `truncated`.
Console entries contain their sequence, level (`log`, `info`, `warn`, `error`,
`debug`) and text. `console.error()` alone does not fail the script.
An execution error contains name, message, stack, path and 1-based line / column
when a source frame is available. Imported-module failures keep their own file
location. Locations unavailable in a browser stack are null. Import rewriting
preserves source lines; columns after a rewritten import on the same line may
refer to generated code.

```javascript
const result = await shell.execute(['js', '--json', '/scripts/build.js']);
const report = JSON.parse(result.stdout);
if (report.status === 'failed') {
  console.log(report.error.path, report.error.line, report.error.message);
}
// After a stopped run, query its retained report separately:
const previous = await shell.execute(['result', '--json']);
```

The shell's abort signal can return the usual cancellation result before the
script's JSON response. After Stop, use `result --json` to obtain the `cancelled`
report and output captured before cancellation. Only the last ten completed
reports are kept in memory. Project invalidation clears reports; they are not
saved in autosave or Cassette ZIPs. Inspecting a result does not rerun code.

Worker console output and host collection are bounded: stdout / stderr each
hold up to 8,000 characters; console records hold up to 100 entries and 8,000
characters, with a 1,000-character excerpt per record. The worker also limits
console message production, preventing a logging loop from flooding the UI.
Serialized reports fit within 32,000 characters, with `truncated` flags marking
omitted stream, console or report content. In JSON mode nested scripts do not
stream extra text into the top-level JSON response.

## Virtual text pipelines and redirection (working tree)

String commands passed to `shell.execute()` support `|`, `<`, `>` and `>>`,
including operators without surrounding spaces. Quotes and escapes keep these
characters literal. Argument arrays always remain literal; use a string when
requesting a pipeline. `parsePipeline(source)` exposes the same parser.
`parseCommand(source)` remains the strict argument-only parser.

```sh
cat /index.js | rg -F setBpm -
read --start 2 --end 10 - < /index.js
patch - < /changes.json
find --json /scripts > /files.json
echo next >> /notes.txt
pipeline --json 'cat /index.js | rg setBpm -'
```

`cat -`, `read -` and `rg PATTERN -` read stdin. Search identifies stdin as path
`-` in its numbered or JSON output. Existing result limits and pagination stay
in effect for `read` and `rg`. `<` reads an existing text file and is supported
on the first pipeline stage. Each stage accepts at most one input and one output
redirect. `>` replaces a text file; `>>` appends or creates it. Binary outputs,
directory targets, missing redirect paths, file descriptors such as `2>` and
command chaining (`&&`, `||`, `;`, background `&`) are rejected.

Stages run sequentially with virtual string buffers. Only stdout is passed to
the next stage; stderr is collected separately. A nonzero stage stops the
pipeline and its code becomes the final code. No matches in `rg` therefore stop
subsequent stages. At most 32 stages and 1,000,000 characters of pipeline input
or intermediate stdout are supported. A stage whose stdout is redirected gives
empty stdin to the next stage. Commands and redirect paths use the pipeline's
starting cwd; a `cd` command can still change cwd for later shell requests.

Output redirects are staged and written together only after every stage
succeeds. Before commit the shell authorizes `redirect` with all output paths
and checks that their contents still match what was read before execution.
A human edit, a binary/directory conflict, denied host policy, failed stage or
cancellation prevents those redirect writes. Validated writes commit in one
filesystem change, preserving unrelated files, binary data and empty directories.
Side effects performed explicitly by stage commands (such as `patch` or `write`)
are not rolled back if a later stage fails.

Pipeline results include `stages: [{command: string[], code: number}]` for the
stages actually executed. `execute(source, {reportStages:true})` also requests
this metadata for a single command. `pipeline --json SOURCE` serializes the
full `{code, stdout, stderr, stages}` result into stdout for terminal/MCP callers.
An aborted wrapper may return the normal code-130 cancellation response.
Playground suppresses direct script streaming during pipelines/redirection,
so only the pipeline's final output and collected stderr appear in the terminal.
Path completion also works after operators, and nested `tetorica:shell` scripts
use the same pipeline implementation and guarded filesystem.
