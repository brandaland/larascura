import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ArchitectureGraph, ArchitectureNode, NodeKind } from './types.js';

type TreeEntry =
  | { type: 'group'; kind: NodeKind; count: number }
  | { type: 'node'; node: ArchitectureNode }
  | { type: 'empty' };

const labels: Partial<Record<NodeKind, string>> = {
  route: 'Routes',
  middleware: 'Middleware',
  request: 'Form Requests',
  controller: 'Controllers',
  page: 'Pages',
  service: 'Services',
  repository: 'Repositories',
  model: 'Models',
  job: 'Jobs',
  event: 'Events',
  listener: 'Listeners',
  provider: 'Providers',
  command: 'Commands',
  class: 'Other Classes',
};

const icons: Record<NodeKind, string> = {
  route: 'git-merge',
  middleware: 'shield',
  request: 'checklist',
  controller: 'symbol-method',
  page: 'browser',
  service: 'tools',
  repository: 'database',
  model: 'symbol-class',
  job: 'server-process',
  event: 'radio-tower',
  listener: 'broadcast',
  provider: 'package',
  command: 'terminal',
  class: 'symbol-class',
};

export class ArchitectureTreeProvider implements vscode.TreeDataProvider<TreeEntry> {
  private readonly changes = new vscode.EventEmitter<TreeEntry | undefined | void>();
  private graph: ArchitectureGraph | undefined;
  public readonly onDidChangeTreeData = this.changes.event;

  public update(graph: ArchitectureGraph): void {
    this.graph = graph;
    this.changes.fire();
  }

  public getTreeItem(element: TreeEntry): vscode.TreeItem {
    if (element.type === 'empty') {
      const item = new vscode.TreeItem('Open a Laravel project, then build its map');
      item.iconPath = new vscode.ThemeIcon('info');
      item.command = { command: 'larascura.openMap', title: 'Open Architecture Map' };
      return item;
    }
    if (element.type === 'group') {
      const item = new vscode.TreeItem(
        `${labels[element.kind] ?? element.kind} (${element.count})`,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon(icons[element.kind]);
      return item;
    }

    const item = new vscode.TreeItem(element.node.label, vscode.TreeItemCollapsibleState.None);
    item.description = path.basename(element.node.location.file);
    item.tooltip = new vscode.MarkdownString(
      `**${element.node.kind}**  \n${element.node.summary}  \n\n${element.node.location.file}:${element.node.location.line}`,
    );
    item.iconPath = new vscode.ThemeIcon(icons[element.node.kind]);
    item.command = {
      command: 'larascura.openNode',
      title: 'Open Source',
      arguments: [element.node],
    };
    return item;
  }

  public getChildren(element?: TreeEntry): TreeEntry[] {
    if (!this.graph) return [{ type: 'empty' }];
    if (!element) {
      const counts = new Map<NodeKind, number>();
      for (const node of this.graph.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
      return [...counts.entries()]
        .sort(([left], [right]) => (labels[left] ?? left).localeCompare(labels[right] ?? right))
        .map(([kind, count]) => ({ type: 'group', kind, count }));
    }
    if (element.type !== 'group') return [];
    return this.graph.nodes
      .filter((node) => node.kind === element.kind)
      .map((node) => ({ type: 'node', node }));
  }
}
