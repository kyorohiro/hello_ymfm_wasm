/** Localize interactive lesson text using the containing page's language. */
export function lessonText(japanese, english) {
  return (globalThis.document?.documentElement?.lang ?? 'ja').startsWith('ja') ? japanese : english;
}
