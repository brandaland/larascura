export interface ClassNameIndex {
  exact: Set<string>;
  short: Map<string, Set<string>>;
}

const shortName = (name: string): string => name.split('\\').pop() ?? name;

export const createClassNameIndex = (names: Iterable<string>): ClassNameIndex => {
  const exact = new Set<string>();
  const short = new Map<string, Set<string>>();
  for (const name of names) {
    exact.add(name);
    const alias = shortName(name);
    const candidates = short.get(alias) ?? new Set<string>();
    candidates.add(name);
    short.set(alias, candidates);
  }
  return { exact, short };
};

export const resolveClassName = (index: ClassNameIndex, name: string): string => {
  if (index.exact.has(name) || name.includes('\\')) return name;
  const candidates = index.short.get(name);
  return candidates?.size === 1 ? [...candidates][0]! : name;
};

export const ambiguousClassNames = (index: ClassNameIndex): string[] =>
  [...index.short.entries()]
    .filter(([, candidates]) => candidates.size > 1)
    .map(([name]) => name)
    .sort();
