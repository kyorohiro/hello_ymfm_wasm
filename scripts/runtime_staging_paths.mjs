import {dirname, isAbsolute, relative, resolve, sep} from 'node:path';

const slash = value => value.split(sep).join('/');

/** Preserve the installed package paths while reorganizing repository sources. */
export function publishedSourcePath(root, file) {
  const name = slash(relative(resolve(root), resolve(file)));
  if (name === '..' || name.startsWith('../') || isAbsolute(name))
    throw new Error(`Dependency outside repository: ${file}`);
  return name.replace(/^tetorica_src\/(runtime|node|cli|native|wasm)(?=\/|$)/,
    (_, kind) => kind === 'runtime' ? 'web' : kind);
}

/** Rewrite static imports, JSDoc imports and module-relative URL expressions.
 * Template URL strings retain interpolation; the dependency walk follows the
 * explicit factory imports rather than trying to execute those templates. */
export function rewriteStagedModule(source, {root, file, overrides = new Map()} = {}) {
  const destination = publishedSourcePath(root, file);
  return source.replace(/\b(?:from\s*|import\s*\(?\s*|new\s+URL\s*\(\s*)(["'`])(\.[^"'`\r\n]+)\1/g,
    (match, quote, specifier) => {
      const [, pathname, suffix = ''] = specifier.match(/^([^?#]*)([?#].*)?$/);
      const target = resolve(dirname(file), pathname);
      const stagedTarget = overrides.get(target) ?? publishedSourcePath(root, target);
      let next = slash(relative(dirname(destination), stagedTarget));
      if (!next.startsWith('.')) next = './' + next;
      if (pathname.endsWith('/') && !next.endsWith('/')) next += '/';
      return match.replace(quote + specifier + quote, quote + next + suffix + quote);
    });
}
