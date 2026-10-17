import * as path from 'node:path';
import * as vscode from 'vscode';
import { GraphPanel } from './graphPanel.js';
import { explainSyntax } from './phpParser.js';
import { ArchitectureTreeProvider } from './treeProvider.js';
import { chooseLaravelRoot, findLaravelRoots, LaravelScanner } from './scanner.js';
import type { ArchitectureGraph, ArchitectureNode } from './types.js';

let graph: ArchitectureGraph | undefined;
let root: vscode.Uri | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

const explanationLanguage = (): 'en' | 'tr' => {
  const configured = vscode.workspace.getConfiguration('larascura').get<string>('explanationLanguage', 'auto');
  if (configured === 'en' || configured === 'tr') return configured;
  return vscode.env.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
};

const isInside = (file: string, parent: string): boolean => {
  const relative = path.relative(parent, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const openNode = async (node: ArchitectureNode): Promise<void> => {
  if (!root || !isInside(node.location.file, root.fsPath)) {
    void vscode.window.showErrorMessage('LaraScura blocked a source path outside the selected Laravel project.');
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(node.location.file));
  const editor = await vscode.window.showTextDocument(document, { preview: true });
  const line = Math.max(0, Math.min(node.location.line - 1, document.lineCount - 1));
  const range = document.lineAt(line).range;
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const scanner = new LaravelScanner();
  const tree = new ArchitectureTreeProvider();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 30);
  status.name = 'LaraScura';
  status.command = 'larascura.openMap';
  status.text = '$(type-hierarchy) LaraScura';
  status.tooltip = 'Open the local Laravel architecture map';
  status.show();

  let watchedRoot: string | undefined;
  const registerWatcher = (candidate: vscode.Uri): void => {
    if (watchedRoot === candidate.fsPath) return;
    if (!vscode.workspace.getConfiguration('larascura').get<boolean>('watchFiles', true)) return;
    watchedRoot = candidate.fsPath;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(candidate, '{app,routes}/**/*.php'),
    );
    const schedule = (): void => {
      if (!graph) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void scan().then((updated) => GraphPanel.updateIfOpen(updated)).catch(() => undefined);
      }, 700);
    };
    watcher.onDidCreate(schedule, null, context.subscriptions);
    watcher.onDidChange(schedule, null, context.subscriptions);
    watcher.onDidDelete(schedule, null, context.subscriptions);
    context.subscriptions.push(watcher);
  };

  const scan = async (): Promise<ArchitectureGraph> => {
    if (!vscode.workspace.isTrusted) {
      throw new Error('Trust this workspace before LaraScura reads and analyzes its PHP source files.');
    }
    root ??= await chooseLaravelRoot();
    if (!root) {
      throw new Error('No Laravel project root was found. Open a folder containing artisan and composer.json.');
    }
    registerWatcher(root);
    status.text = '$(loading~spin) LaraScura scanning';
    try {
      graph = await scanner.scan(root);
      tree.update(graph);
      status.text = `$(type-hierarchy) LaraScura ${graph.nodes.length}`;
      status.tooltip = `${graph.projectName}: ${graph.nodes.length} nodes, ${graph.edges.length} connections`;
      return graph;
    } finally {
      if (!graph) status.text = '$(type-hierarchy) LaraScura';
    }
  };

  const scanWithUi = async (): Promise<ArchitectureGraph | undefined> => {
    try {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'LaraScura is reading Laravel syntax…',
          cancellable: false,
        },
        scan,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
      return undefined;
    }
  };

  context.subscriptions.push(
    status,
    vscode.window.registerTreeDataProvider('larascura.explorer', tree),
    vscode.commands.registerCommand('larascura.openMap', async () => {
      const current = graph ?? (await scanWithUi());
      if (!current) return;
      GraphPanel.show(context, current, async () => (await scanWithUi()) ?? current);
    }),
    vscode.commands.registerCommand('larascura.refresh', async () => {
      const refreshed = await scanWithUi();
      if (refreshed) GraphPanel.updateIfOpen(refreshed);
    }),
    vscode.commands.registerCommand('larascura.openNode', openNode),
    vscode.commands.registerCommand('larascura.explainSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'php') {
        void vscode.window.showInformationMessage('Select Laravel PHP syntax before running LaraScura Explain.');
        return;
      }
      const selection = editor.selection.isEmpty
        ? editor.document.lineAt(editor.selection.active.line).text
        : editor.document.getText(editor.selection);
      const explanation = explainSyntax(selection, explanationLanguage());
      await vscode.window.showInformationMessage(explanation, { modal: true }, 'Open Architecture Map').then(
        (choice) => choice === 'Open Architecture Map' && vscode.commands.executeCommand('larascura.openMap'),
      );
    }),
  );

  if (vscode.workspace.workspaceFolders?.length) {
    const roots = await findLaravelRoots();
    const onlyRoot = roots.length === 1 ? roots[0] : undefined;
    if (onlyRoot) {
      root = onlyRoot;
      registerWatcher(root);
    }
  }
}

export function deactivate(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
}
