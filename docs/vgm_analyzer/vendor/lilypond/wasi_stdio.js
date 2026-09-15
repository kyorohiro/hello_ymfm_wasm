// The bundled WASI host excludes FD_TELL from the rights of descriptors 0–2.
// Preserve its NOTCAPABLE result for these streams, without throwing/logging
// the expected capability probe. Do not grant rights or alter regular files.
export function withQuietStdioTell(imports) {
  const wasi = imports.wasi_snapshot_preview1;
  const tell = wasi.fd_tell;
  return { ...imports, wasi_snapshot_preview1: { ...wasi,
    fd_tell(fd, offset) {
      if (fd === 0 || fd === 1 || fd === 2) return 76;
      return tell(fd, offset);
    },
  } };
}
