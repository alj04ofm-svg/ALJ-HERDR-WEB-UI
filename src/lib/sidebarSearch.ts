/** Match all query words against native names and cwd, without changing the roster's order. */
export function sidebarMatches(query: string, ...names: readonly string[]): boolean {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = names.join(" ").toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}
