import type { ArchitectureEdge, ArchitectureGraph, ArchitectureNode } from './types.js';

export interface LensEntry {
  /** 1-based source line the lens sits above. */
  line: number;
  title: string;
  tooltip: string;
  command:
    | { id: 'larascura.revealInMap'; nodeId: string }
    | { id: 'larascura.openMethod'; file: string; method: string };
}

const maxRoutesPerAction = 2;

const sameFile = (left: string, right: string): boolean =>
  left.replaceAll('\\', '/') === right.replaceAll('\\', '/');

const methodLine = (lines: string[], method: string): number | undefined => {
  const pattern = new RegExp(`function\\s+&?\\s*${method.replace(/[^\w]/g, '')}\\s*\\(`);
  const index = lines.findIndex((line) => pattern.test(line));
  return index === -1 ? undefined : index + 1;
};

const middlewareSummary = (graph: ArchitectureGraph, route: ArchitectureNode): string => {
  const names = graph.edges
    .filter((edge) => edge.kind === 'middleware' && edge.source === route.id)
    .map((edge) => edge.label);
  return names.length ? ` · ${names.join(', ')}` : '';
};

const connectionCount = (graph: ArchitectureGraph, node: ArchitectureNode): number =>
  graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id).length;

/**
 * Computes the CodeLens entries for one file from the last scanned graph:
 * - route files: `→ Controller@action` above each route declaration;
 * - controllers: the routes (and their middleware) that reach each action;
 * - every class defined in the file: a connection count that reveals it in the map.
 */
export const codeLensEntries = (graph: ArchitectureGraph, file: string, text: string): LensEntry[] => {
  const lines = text.split(/\r?\n/);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const handles = graph.edges.filter((edge) => edge.kind === 'handles');
  const entries: LensEntry[] = [];

  const routesHere = graph.nodes.filter((node) => node.kind === 'route' && sameFile(node.location.file, file));
  const routesByLine = new Map<number, ArchitectureNode[]>();
  for (const route of routesHere) {
    routesByLine.set(route.location.line, [...(routesByLine.get(route.location.line) ?? []), route]);
  }
  for (const [line, routes] of [...routesByLine.entries()].sort(([left], [right]) => left - right)) {
    const targets = new Map<string, { controller: ArchitectureNode; actions: string[] }>();
    for (const route of routes) {
      for (const edge of handles.filter((candidate) => candidate.source === route.id)) {
        const controller = nodesById.get(edge.target);
        if (!controller) continue;
        const current = targets.get(controller.id) ?? { controller, actions: [] };
        if (!current.actions.includes(edge.label)) current.actions.push(edge.label);
        targets.set(controller.id, current);
      }
    }
    for (const { controller, actions } of targets.values()) {
      const title = actions.length === 1
        ? `→ ${controller.label}@${actions[0]}`
        : `→ ${controller.label} · ${actions.join(', ')}`;
      entries.push({
        line,
        title,
        tooltip: `Open ${controller.qualifiedName ?? controller.label}`,
        command: controller.external
          ? { id: 'larascura.revealInMap', nodeId: controller.id }
          : { id: 'larascura.openMethod', file: controller.location.file, method: actions[0] ?? '__invoke' },
      });
    }
    entries.push({
      line,
      title: '$(type-hierarchy) Show flow',
      tooltip: 'Show this request flow in the LaraScura map',
      command: { id: 'larascura.revealInMap', nodeId: routes[0]!.id },
    });
  }

  const definedHere = graph.nodes.filter(
    (node) => node.kind !== 'route' && !node.external && sameFile(node.location.file, file),
  );
  for (const node of definedHere) {
    const count = connectionCount(graph, node);
    entries.push({
      line: node.location.line,
      title: `$(type-hierarchy) ${count} connection${count === 1 ? '' : 's'}`,
      tooltip: `Show ${node.label} and its direct connections in the LaraScura map`,
      command: { id: 'larascura.revealInMap', nodeId: node.id },
    });

    if (node.kind !== 'controller') continue;
    const byAction = new Map<string, ArchitectureEdge[]>();
    for (const edge of handles.filter((candidate) => candidate.target === node.id)) {
      byAction.set(edge.label, [...(byAction.get(edge.label) ?? []), edge]);
    }
    for (const [action, edges] of byAction) {
      const line = methodLine(lines, action);
      if (line === undefined) continue;
      const routes = edges.map((edge) => nodesById.get(edge.source)).filter((route) => route !== undefined);
      for (const route of routes.slice(0, maxRoutesPerAction)) {
        entries.push({
          line,
          title: `$(globe) ${route.label}${middlewareSummary(graph, route)}`,
          tooltip: `${route.location.file}:${route.location.line}`,
          command: { id: 'larascura.revealInMap', nodeId: route.id },
        });
      }
      if (routes.length > maxRoutesPerAction) {
        entries.push({
          line,
          title: `+${routes.length - maxRoutesPerAction} more`,
          tooltip: 'Show every route that reaches this action',
          command: { id: 'larascura.revealInMap', nodeId: node.id },
        });
      }
    }
  }

  return entries;
};

/** Picks the node "Reveal in Map" should focus for a cursor position in a file. */
export const nodeAtCursor = (
  graph: ArchitectureGraph,
  file: string,
  cursorLine: number,
): ArchitectureNode | undefined => {
  const here = graph.nodes.filter((node) => !node.external && sameFile(node.location.file, file));
  const routes = here.filter((node) => node.kind === 'route').sort((left, right) => left.location.line - right.location.line);
  if (routes.length) {
    return [...routes].reverse().find((route) => route.location.line <= cursorLine) ?? routes[0];
  }
  return here.sort((left, right) => left.location.line - right.location.line)[0];
};
