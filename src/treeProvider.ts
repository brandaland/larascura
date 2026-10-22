import * as path from 'node:path';
import * as vscode from 'vscode';
import { groupLabel, layerGroups } from './nodeGroups.js';
import type { ArchitectureGraph, ArchitectureNode, NodeKind } from './types.js';

type TreeEntry =
  | { type: 'action'; action: 'openMap' | 'doctor' }
  | { type: 'group'; kind: NodeKind; count: number }
  | { type: 'folder'; kind: NodeKind; group: string; nodes: ArchitectureNode[] }
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

// Same order as the map: the way a request travels through the app.
const lifecycleOrder: NodeKind[] = ['route', 'middleware', 'request', 'controller', 'page', 'service', 'repository', 'provider', 'model', 'event', 'listener', 'job', 'command', 'class'];

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

// The same colors as the map, contributed in package.json so themes can override them.
const layerIcon = (kind: NodeKind, icon = icons[kind]): vscode.ThemeIcon =>
  new vscode.ThemeIcon(icon, new vscode.ThemeColor(`larascura.layer.${kind}`));

export class ArchitectureTreeProvider implements vscode.TreeDataProvider<TreeEntry> {
  private readonly changes = new vscode.EventEmitter<TreeEntry | undefined | void>();
  private graph: ArchitectureGraph | undefined;
  public readonly onDidChangeTreeData = this.changes.event;

  public update(graph: ArchitectureGraph): void {
    this.graph = graph;
    this.changes.fire();
  }

  public getTreeItem(element: TreeEntry): vscode.TreeItem {
    if (element.type === 'empty' || (element.type === 'action' && element.action === 'openMap')) {
      const item = new vscode.TreeItem('Open Architecture Map');
      item.iconPath = new vscode.ThemeIcon('type-hierarchy');
      item.tooltip = 'Open the LaraScura map of this Laravel project';
      item.command = { command: 'larascura.openMap', title: 'Open Architecture Map' };
      return item;
    }
    if (element.type === 'action') {
      const findings = this.graph?.findings ?? [];
      const mistakes = findings.filter((finding) => finding.severity === 'warning').length;
      const item = new vscode.TreeItem(`Doctor · ${mistakes ? `${mistakes} possible mistake${mistakes === 1 ? '' : 's'}` : `${findings.length} tip${findings.length === 1 ? '' : 's'}`}`);
      item.iconPath = new vscode.ThemeIcon(mistakes ? 'warning' : 'info');
      item.tooltip = 'Show LaraScura Doctor findings in the Problems panel';
      item.command = { command: 'workbench.actions.view.problems', title: 'Show Problems' };
      return item;
    }
    if (element.type === 'group') {
      const item = new vscode.TreeItem(
        `${element.kind === 'page' && this.graph?.pageFramework ? `${this.graph.pageFramework} Pages` : labels[element.kind] ?? element.kind} (${element.count})`,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = layerIcon(element.kind);
      return item;
    }
    if (element.type === 'folder') {
      const item = new vscode.TreeItem(groupLabel(element.kind, element.group), vscode.TreeItemCollapsibleState.Collapsed);
      item.description = String(element.nodes.length);
      item.iconPath = layerIcon(element.kind, 'folder');
      return item;
    }

    const item = new vscode.TreeItem(element.node.label, vscode.TreeItemCollapsibleState.None);
    item.description = path.basename(element.node.location.file);
    item.tooltip = new vscode.MarkdownString(
      `**${element.node.kind}**  \n${element.node.summary}  \n\n${element.node.location.file}:${element.node.location.line}`,
    );
    item.iconPath = layerIcon(element.node.kind);
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
      const actions: TreeEntry[] = [{ type: 'action', action: 'openMap' }];
      if (this.graph.findings.length) actions.push({ type: 'action', action: 'doctor' });
      return [
        ...actions,
        ...[...counts.entries()]
          .sort(([left], [right]) => lifecycleOrder.indexOf(left) - lifecycleOrder.indexOf(right))
          .map(([kind, count]): TreeEntry => ({ type: 'group', kind, count })),
      ];
    }
    if (element.type === 'folder') return element.nodes.map((node) => ({ type: 'node', node }));
    if (element.type !== 'group') return [];
    // A layer spread over several folders opens into those folders, like the map's navigator.
    const groups = layerGroups(this.graph.nodes, element.kind);
    if (groups.length > 1) return groups.map(({ group, nodes }) => ({ type: 'folder', kind: element.kind, group, nodes }));
    return (groups[0]?.nodes ?? []).map((node) => ({ type: 'node', node }));
  }
}
