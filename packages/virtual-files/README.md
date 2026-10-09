# tetorica-virtual-files

Memory filesystem and a small extensible shell for browser and Node.js tools.
The package has no sound-chip, DOM, storage or network dependency. npm publication
is pending; build its distribution with `npm run build:virtual-files` in the repository root.

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
`touch`, `write PATH TEXT`, `echo` and `help`. `cp` and `mv` accept files or entire directories.
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

Custom commands receive `fs`, `args`, `cwd`, `resolve`, `signal` and `stdin`.
An `authorize(operation, paths)` callback can reject built-in file mutations.
Custom commands must enforce their own host policies. This library is not a
security sandbox for arbitrary JavaScript.

Git and JavaScript formatting/checking tools are planned extensions. There is no
Git implementation, remote access, filesystem mount or `tetorica-fm2612` re-export yet.
