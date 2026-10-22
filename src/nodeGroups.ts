import type { ArchitectureNode, NodeKind } from './types.js';

// Mirrors nodeGroup() in the map's webview script so the sidebar and the map show the same folders.

/** Each layer's conventional folder; a class's group is the subfolder below it (Controllers/Admin → Admin). */
const baseFolders: Partial<Record<NodeKind, string>> = {
  controller: 'Controllers', middleware: 'Middleware', request: 'Requests', model: 'Models', service: 'Services',
  repository: 'Repositories', job: 'Jobs', event: 'Events', listener: 'Listeners', provider: 'Providers', command: 'Commands',
};

const routeModule = (node: ArchitectureNode): string =>
  node.label.replace(/^[A-Z|]+\s+\/?/, '').split('/').filter(Boolean)[0] ?? 'root';

export const nodeGroup = (node: ArchitectureNode): string => {
  if (node.kind === 'route') return routeModule(node);
  if (node.kind === 'page') return node.label.includes('/') ? node.label.split('/')[0] ?? '' : '';
  const parts = (node.qualifiedName ?? '').split('\\').slice(0, -1);
  const base = parts.lastIndexOf(baseFolders[node.kind] ?? '');
  if (base >= 0) return parts[base + 1] ?? '';
  // Outside the usual folder (support classes, copied libraries): the namespace says where it lives.
  return (parts[0] === 'App' ? parts.slice(1) : parts).slice(0, 2).join('/');
};

export const groupLabel = (kind: NodeKind, group: string): string => {
  if (kind === 'route') return `/${group === 'root' ? '' : group}`;
  if (group) return `${group}/`;
  return `${kind === 'page' ? 'Pages' : baseFolders[kind] ?? 'App'}/`;
};

/** A layer's nodes by folder: the top-level folder first, the rest alphabetically. */
export const layerGroups = (nodes: ArchitectureNode[], kind: NodeKind): Array<{ group: string; nodes: ArchitectureNode[] }> => {
  const groups = new Map<string, ArchitectureNode[]>();
  for (const node of nodes) {
    if (node.kind !== kind) continue;
    const group = nodeGroup(node);
    groups.set(group, [...(groups.get(group) ?? []), node]);
  }
  const isRoot = (group: string): boolean => group === '' || group === 'root';
  return [...groups.entries()]
    .sort(([left], [right]) => (isRoot(left) ? -1 : isRoot(right) ? 1 : left.localeCompare(right)))
    .map(([group, members]) => ({ group, nodes: members }));
};
