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
`{code, stdout, stderr}`. Pipes, redirection, chaining, expansions, host commands
and JavaScript execution are outside this initial implementation.

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
| `edit [--expect N] [--dry-run] PATH OLD_TEXT NEW_TEXT` | Exact, nonoverlapping replacement, defaulting to exactly one occurrence |

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
`--max-chars` accepts 1..64000. Its JSON includes `path`, `lines` (line / text),
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
