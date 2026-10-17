import * as vscode from 'vscode';
import type { ArchitectureGraph } from './types.js';

const nonce = (): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
};

export class GraphPanel {
  private static current: GraphPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private graph: ArchitectureGraph;
  private readonly onRefresh: () => Promise<ArchitectureGraph>;
  private ready = false;
  private pendingFocus: string | undefined;

  public static show(
    context: vscode.ExtensionContext,
    graph: ArchitectureGraph,
    onRefresh: () => Promise<ArchitectureGraph>,
    focusNodeId?: string,
  ): GraphPanel {
    if (GraphPanel.current) {
      GraphPanel.current.graph = graph;
      // A hidden webview reloads on reveal and announces itself again with 'ready'.
      if (!GraphPanel.current.panel.visible) GraphPanel.current.ready = false;
      GraphPanel.current.panel.reveal(vscode.ViewColumn.One);
      GraphPanel.current.postGraph();
      if (focusNodeId) GraphPanel.current.focus(focusNodeId);
      return GraphPanel.current;
    }

    GraphPanel.current = new GraphPanel(context, graph, onRefresh);
    if (focusNodeId) GraphPanel.current.focus(focusNodeId);
    return GraphPanel.current;
  }

  /** Focuses a node once the webview has its graph; earlier requests wait for the ready message. */
  public focus(nodeId: string): void {
    if (!this.ready) {
      this.pendingFocus = nodeId;
      return;
    }
    void this.panel.webview.postMessage({ type: 'focus', nodeId });
  }

  public static updateIfOpen(graph: ArchitectureGraph): boolean {
    if (!GraphPanel.current) return false;
    GraphPanel.current.update(graph);
    return true;
  }

  private constructor(
    context: vscode.ExtensionContext,
    graph: ArchitectureGraph,
    onRefresh: () => Promise<ArchitectureGraph>,
  ) {
    this.graph = graph;
    this.onRefresh = onRefresh;
    this.panel = vscode.window.createWebviewPanel(
      'larascura.map',
      `LaraScura — ${graph.projectName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [],
      },
    );
    this.panel.webview.html = this.html();
    this.panel.onDidDispose(() => {
      GraphPanel.current = undefined;
    }, null, context.subscriptions);
    this.panel.webview.onDidReceiveMessage(
      async (message: { type?: string; nodeId?: string; edgeId?: string }) => {
        if (message.type === 'ready') {
          this.ready = true;
          this.postGraph();
          if (this.pendingFocus) this.focus(this.pendingFocus);
          this.pendingFocus = undefined;
          return;
        }
        if (message.type === 'refresh') {
          await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'LaraScura is rebuilding the map…' },
            async () => {
              this.graph = await this.onRefresh();
              this.postGraph();
            },
          );
          return;
        }
        if (message.type === 'openNode' && message.nodeId) {
          const node = this.graph.nodes.find((candidate) => candidate.id === message.nodeId);
          if (node) await this.openLocation(node.location);
          return;
        }
        if (message.type === 'openEdge' && message.edgeId) {
          const edge = this.graph.edges.find((candidate) => candidate.id === message.edgeId);
          if (edge) await this.openLocation(edge.location);
        }
      },
      null,
      context.subscriptions,
    );
  }

  public update(graph: ArchitectureGraph): void {
    this.graph = graph;
    this.postGraph();
  }

  private postGraph(): void {
    void this.panel.webview.postMessage({ type: 'graph', graph: this.graph });
  }

  private async openLocation(location: { file: string; line: number }): Promise<void> {
    const normalizedRoot = this.graph.root.endsWith('/') ? this.graph.root : `${this.graph.root}/`;
    const normalizedFile = location.file.replaceAll('\\', '/');
    const root = normalizedRoot.replaceAll('\\', '/');
    if (normalizedFile !== root.slice(0, -1) && !normalizedFile.startsWith(root)) {
      void vscode.window.showErrorMessage('LaraScura blocked a source path outside the Laravel workspace.');
      return;
    }

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(location.file));
    const editor = await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
    const line = Math.max(0, Math.min(location.line - 1, document.lineCount - 1));
    const range = document.lineAt(line).range;
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private html(): string {
    return createGraphHtml(nonce());
  }
}

export const createGraphHtml = (token: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'nonce-${token}'; script-src 'nonce-${token}';">
  <title>LaraScura</title>
  <style nonce="${token}">
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); overflow: hidden; }
    button, input, select { font: inherit; }
    .app { height: 100vh; display: grid; grid-template-rows: auto 1fr; }
    .toolbar { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .brand { display: flex; align-items: center; gap: 8px; margin-right: 4px; font-weight: 700; white-space: nowrap; }
    .brand-mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; color: white; background: #7c3aed; }
    .search { width: min(340px, 32vw); height: 32px; padding: 0 10px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; outline: none; }
    .search:focus { border-color: var(--vscode-focusBorder); }
    .tool-button { height: 32px; padding: 0 12px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 6px; cursor: pointer; }
    .tool-button:hover { background: var(--vscode-button-hoverBackground); }
    .tool-button.secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground); }
    .tool-button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .zoom { width: 100px; accent-color: #7c3aed; }
    .stats { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 12px; white-space: nowrap; }
    .workspace { position: relative; min-height: 0; display: grid; grid-template-columns: 250px minmax(0, 1fr) 340px; }
    .workspace.inspector-collapsed { grid-template-columns: 250px minmax(0, 1fr); }
    .navigator { min-width: 0; overflow-y: auto; padding: 12px 8px; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .nav-heading { margin: 5px 8px 10px; color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; }
    .nav-section { margin: 7px 0; }
    .nav-section > summary, .nav-module > summary { display: flex; align-items: center; min-height: 30px; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 650; list-style: none; }
    .nav-section > summary::-webkit-details-marker, .nav-module > summary::-webkit-details-marker { display: none; }
    .nav-section > summary::before, .nav-module > summary::before { content: '›'; width: 16px; color: var(--vscode-descriptionForeground); transition: transform .15s ease; }
    .nav-section[open] > summary::before, .nav-module[open] > summary::before { transform: rotate(90deg); }
    .nav-module { margin-left: 8px; }
    .nav-module > summary { min-height: 28px; font-weight: 500; }
    .nav-module > summary .nav-count { margin-left: auto; }
    .nav-button { display: grid; width: 100%; min-height: 30px; grid-template-columns: 1fr auto; align-items: center; gap: 8px; padding: 5px 8px 5px 24px; color: var(--vscode-foreground); background: transparent; border: 0; border-radius: 6px; text-align: left; cursor: pointer; }
    .nav-button.root { padding-left: 8px; font-weight: 650; }
    .nav-button.route-item { padding-left: 32px; font-family: var(--vscode-editor-font-family); font-size: 10px; }
    .nav-button:hover { background: var(--vscode-list-hoverBackground); }
    .nav-button.active { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
    .nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nav-count { color: var(--vscode-descriptionForeground); font-size: 10px; font-variant-numeric: tabular-nums; }
    .scope-bar { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; min-height: 38px; gap: 8px; padding: 6px 12px; color: var(--vscode-descriptionForeground); background: color-mix(in srgb, var(--vscode-editor-background) 92%, transparent); border-bottom: 1px solid var(--vscode-panel-border); backdrop-filter: blur(8px); font-size: 11px; }
    .scope-name { color: var(--vscode-foreground); font-weight: 650; }
    .scope-note { margin-left: auto; }
    .viewport { position: relative; overflow: auto; background-image: radial-gradient(var(--vscode-panel-border) 0.7px, transparent 0.7px); background-size: 18px 18px; }
    .stage { position: relative; min-width: 1100px; min-height: 760px; transform-origin: top left; }
    .edges { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .edge-visible { stroke: var(--vscode-descriptionForeground); stroke-width: 1.2; opacity: .42; fill: none; }
    .edge-hit { stroke: transparent; stroke-width: 14; fill: none; pointer-events: stroke; cursor: pointer; }
    .edge-group:hover .edge-visible, .edge-group:focus .edge-visible { stroke: #a78bfa; stroke-width: 2.4; opacity: 1; }
    .node { position: absolute; width: 172px; min-height: 58px; padding: 9px 10px; text-align: left; color: var(--vscode-foreground); background: var(--vscode-editorWidget-background); border: 1px solid var(--node-color); border-left-width: 4px; border-radius: 8px; box-shadow: 0 3px 12px rgba(0,0,0,.16); cursor: grab; touch-action: none; user-select: none; }
    .node.dragging { z-index: 3; cursor: grabbing; box-shadow: 0 8px 24px rgba(0,0,0,.28); }
    .node:hover, .node:focus-visible, .node.active { outline: 2px solid var(--node-color); outline-offset: 2px; }
    .node-kind { display: block; margin-bottom: 4px; color: var(--node-color); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .node-label { display: block; overflow: hidden; font-size: 12px; font-weight: 650; line-height: 1.3; text-overflow: ellipsis; }
    .column-label { position: absolute; top: 18px; width: 172px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-align: center; text-transform: uppercase; }
    .detail { min-width: 0; overflow-y: auto; border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
    .detail.closed { display: none; }
    .detail.minimized { position: absolute; z-index: 8; right: 12px; bottom: 12px; width: min(360px, calc(100% - 24px)); overflow: hidden; border: 1px solid var(--vscode-panel-border); border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.25); }
    .detail.minimized .detail-content { display: none; }
    .detail-toolbar { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; min-height: 38px; padding: 0 8px 0 12px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); }
    .detail.minimized .detail-toolbar { border-bottom: 0; }
    .detail-title { min-width: 0; overflow: hidden; font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .detail-actions { display: flex; gap: 2px; margin-left: auto; }
    .detail-action { display: grid; width: 28px; height: 28px; padding: 0; place-items: center; color: var(--vscode-foreground); background: transparent; border: 0; border-radius: 5px; cursor: pointer; }
    .detail-action:hover { background: var(--vscode-toolbar-hoverBackground); }
    .detail-content { padding: 18px; }
    .detail-empty { margin-top: 28px; color: var(--vscode-descriptionForeground); line-height: 1.6; }
    .badge { display: inline-flex; padding: 3px 7px; border-radius: 999px; color: white; background: var(--detail-color, #7c3aed); font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .detail h2 { margin: 12px 0 4px; font-size: 18px; overflow-wrap: anywhere; }
    .qualified { margin: 0 0 18px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 11px; overflow-wrap: anywhere; }
    .section { padding: 14px 0; border-top: 1px solid var(--vscode-panel-border); }
    .section h3 { margin: 0 0 8px; font-size: 12px; }
    .section p { margin: 0; font-size: 12px; line-height: 1.55; }
    .code { margin-top: 9px; padding: 9px; overflow: auto; color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); border-radius: 6px; font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: pre-wrap; }
    .source-button { width: 100%; margin-top: 14px; }
    .warning { padding: 8px 10px; color: var(--vscode-editorWarning-foreground); background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); border-radius: 6px; font-size: 11px; }
    .specimen { margin: 0 4px 14px; padding: 12px 12px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 10px; background: color-mix(in srgb, var(--vscode-editor-background) 65%, transparent); }
    .specimen-eyebrow { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 9px; letter-spacing: .18em; text-transform: uppercase; }
    .specimen-name { display: block; width: 100%; margin: 5px 0 3px; padding: 0; overflow: hidden; color: var(--vscode-foreground); background: none; border: 0; font-size: 13px; font-weight: 700; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
    .specimen-name:hover, .specimen-name.active { color: var(--vscode-textLink-foreground); }
    .specimen-stats { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 10px; font-variant-numeric: tabular-nums; }
    .specimen-stats strong { color: var(--vscode-foreground); font-weight: 650; }
    .spectrum { display: flex; gap: 1px; height: 9px; margin-top: 11px; overflow: hidden; border-radius: 5px; background: var(--vscode-panel-border); }
    .spectrum-segment { min-width: 3px; padding: 0; background: var(--segment-color); border: 0; opacity: .82; cursor: pointer; transition: opacity .15s ease; }
    .spectrum-segment:hover, .spectrum-segment:focus-visible { opacity: 1; outline: none; }
    .spectrum-caption { display: flex; justify-content: space-between; margin-top: 5px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 9px; letter-spacing: .04em; }
    .nav-caption { margin: -2px 8px 6px 24px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .lifecycle { position: relative; margin: 2px 0 4px; }
    .lifecycle::before { content: ''; position: absolute; top: 15px; bottom: 15px; left: 19px; width: 2px; border-radius: 1px; background: linear-gradient(#22c55e, #3b82f6 30%, #ef4444 60%, #94a3b8); opacity: .35; }
    .layer-button { position: relative; display: grid; width: 100%; min-height: 29px; grid-template-columns: 22px minmax(0, 1fr) 42px 30px; align-items: center; gap: 6px; padding: 3px 8px 3px 8px; color: var(--vscode-foreground); background: transparent; border: 0; border-radius: 6px; font-size: 12px; text-align: left; cursor: pointer; }
    .layer-button:hover { background: var(--vscode-list-hoverBackground); }
    .layer-button.active { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
    .layer-dot { z-index: 1; width: 9px; height: 9px; margin-left: 7px; border-radius: 50%; background: var(--layer-color); box-shadow: 0 0 0 3px var(--vscode-sideBar-background), 0 0 0 5px color-mix(in srgb, var(--layer-color) 28%, transparent); }
    .layer-bar { height: 4px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, var(--layer-color) 18%, transparent); }
    .layer-bar > span { display: block; height: 100%; border-radius: 2px; background: var(--layer-color); }
    .layer-count { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 10px; font-variant-numeric: tabular-nums; text-align: right; }
    .layer-button.active .layer-count { color: inherit; }
    .method { display: inline-block; min-width: 40px; margin-right: 7px; padding: 1px 4px; border-radius: 3px; color: var(--method-color); background: color-mix(in srgb, var(--method-color) 15%, transparent); font-size: 9px; font-weight: 700; letter-spacing: .03em; text-align: center; }
    .degree { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; margin: 2px 0 16px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 10px; font-variant-numeric: tabular-nums; }
    .degree-side { display: grid; gap: 4px; }
    .degree-side.out { text-align: right; }
    .degree-bar { display: flex; height: 4px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, var(--detail-color, #7c3aed) 16%, transparent); }
    .degree-side.in .degree-bar { justify-content: flex-end; }
    .degree-bar > span { display: block; height: 100%; background: var(--detail-color, #7c3aed); }
    .degree-core { width: 12px; height: 12px; border-radius: 50%; background: var(--detail-color, #7c3aed); box-shadow: 0 0 0 4px color-mix(in srgb, var(--detail-color, #7c3aed) 22%, transparent); }
    .connection-list { display: grid; gap: 1px; }
    .connection { display: grid; width: 100%; grid-template-columns: 12px 72px minmax(0, 1fr); align-items: center; gap: 6px; padding: 5px 6px; color: var(--vscode-foreground); background: transparent; border: 0; border-radius: 5px; font-size: 11px; text-align: left; cursor: pointer; }
    .connection:hover { background: var(--vscode-list-hoverBackground); }
    .connection-dir { color: var(--vscode-descriptionForeground); }
    .connection-kind { overflow: hidden; color: var(--kind-color); font-family: var(--vscode-editor-font-family); font-size: 9px; letter-spacing: .05em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
    .connection-target { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .connection-more { padding: 6px; color: var(--vscode-descriptionForeground); font-size: 10px; }
    .emblem { display: block; width: 132px; height: 70px; margin: 0 0 14px; }
    .emblem-link { fill: none; stroke: var(--vscode-descriptionForeground); stroke-width: 1.4; opacity: .45; }
    .emblem-node { stroke: var(--vscode-sideBar-background); stroke-width: 2; }
    .emblem-route { fill: #22c55e; } .emblem-middleware { fill: #f59e0b; } .emblem-controller { fill: #3b82f6; }
    .emblem-service { fill: #8b5cf6; } .emblem-model { fill: #ef4444; } .emblem-event { fill: #eab308; }
    .emblem-caption { margin-top: 12px; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); font-size: 10px; letter-spacing: .04em; }
    .hidden { display: none !important; }
    @media (max-width: 1050px) {
      .workspace { grid-template-columns: 220px 1fr; }
      .detail:not(.closed):not(.minimized) { position: absolute; z-index: 7; right: 0; bottom: 0; width: min(88vw, 340px); max-height: 55vh; border-top: 1px solid var(--vscode-panel-border); box-shadow: -8px -8px 24px rgba(0,0,0,.2); }
      .stats { display: none; }
    }
    @media (max-width: 650px) {
      .workspace { grid-template-columns: 180px 1fr; }
      .brand span:last-child, .zoom { display: none; }
      .search { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="toolbar">
      <div class="brand"><span class="brand-mark">L</span><span>LaraScura</span></div>
      <input id="search" class="search" type="search" placeholder="Filter routes, classes, models…" aria-label="Filter architecture nodes">
      <button id="refresh" class="tool-button" type="button">Refresh</button>
      <button id="resetLayout" class="tool-button secondary" type="button" title="Return nodes to the automatic layout">Reset layout</button>
      <input id="zoom" class="zoom" type="range" min="55" max="135" value="100" aria-label="Graph zoom">
      <span id="stats" class="stats">Waiting for scan…</span>
    </header>
    <div id="workspace" class="workspace">
      <nav id="tree" class="navigator" aria-label="Laravel architecture categories"></nav>
      <main id="viewport" class="viewport" aria-label="Laravel architecture graph">
        <div id="scopeBar" class="scope-bar"><span>Scope</span><span id="scopeName" class="scope-name">Overview</span><span id="scopeNote" class="scope-note"></span></div>
        <div id="stage" class="stage"><svg id="edges" class="edges" aria-hidden="true"></svg><div id="nodes"></div></div>
      </main>
      <aside id="detail" class="detail" aria-live="polite">
        <header class="detail-toolbar">
          <span id="detailTitle" class="detail-title">Inspector</span>
          <span class="detail-actions">
            <button id="minimizeDetail" class="detail-action" type="button" title="Minimize Inspector" aria-label="Minimize Inspector">−</button>
            <button id="closeDetail" class="detail-action" type="button" title="Close Inspector" aria-label="Close Inspector">×</button>
          </span>
        </header>
        <div id="detailContent" class="detail-content">
          <div class="detail-empty">
            <svg class="emblem" viewBox="0 0 132 70" role="img" aria-label="A request travelling from route to model">
              <path class="emblem-link" d="M12 35 C 26 35, 30 35, 40 35 M40 35 C 52 35, 56 35, 68 35 M68 35 C 80 35, 84 16, 96 16 M68 35 C 80 35, 84 54, 96 54 M96 16 C 108 16, 112 16, 120 16 M96 54 C 108 54, 112 54, 120 54"/>
              <circle class="emblem-node emblem-route" cx="12" cy="35" r="6"/>
              <circle class="emblem-node emblem-middleware" cx="40" cy="35" r="5"/>
              <circle class="emblem-node emblem-controller" cx="68" cy="35" r="7"/>
              <circle class="emblem-node emblem-service" cx="96" cy="16" r="5"/>
              <circle class="emblem-node emblem-model" cx="96" cy="54" r="5"/>
              <circle class="emblem-node emblem-event" cx="120" cy="16" r="4"/>
              <circle class="emblem-node emblem-model" cx="120" cy="54" r="4"/>
            </svg>
            <strong>Explore how Laravel works.</strong><br>Select a node or connection to see why it exists, which syntax created it, and where it lives in your project.
            <div class="emblem-caption">route → middleware → controller → service → model</div>
          </div>
        </div>
      </aside>
    </div>
  </div>
  <script nonce="${token}">
    const vscode = acquireVsCodeApi();
    const colors = {
      route: '#22c55e', middleware: '#f59e0b', request: '#f97316', controller: '#3b82f6',
      service: '#8b5cf6', repository: '#a855f7', model: '#ef4444',
      job: '#64748b', event: '#eab308', listener: '#14b8a6',
      provider: '#ec4899', command: '#06b6d4', class: '#94a3b8'
    };
    const layers = [
      ['route'], ['middleware', 'request'], ['controller'], ['service', 'repository', 'provider'],
      ['model', 'class'], ['event', 'job', 'listener', 'command']
    ];
    const kindLabels = {
      route: 'Routes', middleware: 'Middleware', request: 'Form Requests', controller: 'Controllers',
      service: 'Services', repository: 'Repositories', model: 'Models',
      job: 'Jobs', event: 'Events', listener: 'Listeners',
      provider: 'Providers', command: 'Commands', class: 'Other classes'
    };
    let graph = null;
    let positions = new Map();
    let manualPositions = new Map();
    let selected = null;
    let scope = { type: 'overview' };
    let zoomLevel = 1;
    let inspectorState = 'open';
    const workspace = document.getElementById('workspace');
    const stage = document.getElementById('stage');
    const nodesRoot = document.getElementById('nodes');
    const edgesRoot = document.getElementById('edges');
    const treeRoot = document.getElementById('tree');
    const detail = document.getElementById('detail');
    const detailContent = document.getElementById('detailContent');
    const detailTitle = document.getElementById('detailTitle');
    const search = document.getElementById('search');
    const stats = document.getElementById('stats');
    const scopeName = document.getElementById('scopeName');
    const scopeNote = document.getElementById('scopeNote');
    const svgNs = 'http://www.w3.org/2000/svg';

    function text(tag, value, className) {
      const element = document.createElement(tag);
      element.textContent = value ?? '';
      if (className) element.className = className;
      return element;
    }

    function routeModule(node) {
      const uri = node.label.replace(/^[A-Z|]+\\s+\\/?/, '');
      return uri.split('/').filter(Boolean)[0] || 'root';
    }

    function scopeKey(value) {
      return value.type + ':' + (value.value || '');
    }

    function layoutKey(nodeId) {
      const query = search.value.trim().toLowerCase();
      return (query ? 'search:' + query : scopeKey(scope)) + '|' + nodeId;
    }

    function persistUiState() {
      vscode.setState({
        manualPositions: [...manualPositions.entries()],
        inspectorState
      });
    }

    function restoreUiState() {
      const saved = vscode.getState() || {};
      if (Array.isArray(saved.manualPositions)) manualPositions = new Map(saved.manualPositions);
      if (['open', 'minimized', 'closed'].includes(saved.inspectorState)) inspectorState = saved.inspectorState;
      setInspectorState(inspectorState, false);
    }

    function setInspectorState(nextState, persist = true) {
      inspectorState = nextState;
      detail.classList.toggle('closed', nextState === 'closed');
      detail.classList.toggle('minimized', nextState === 'minimized');
      workspace.classList.toggle('inspector-collapsed', nextState !== 'open');
      if (persist) persistUiState();
    }

    function openInspector(title) {
      detailTitle.textContent = title || 'Inspector';
      setInspectorState('open');
    }

    function connected(seedIds, depth, limit) {
      const included = new Set(seedIds);
      let frontier = new Set(seedIds);
      for (let level = 0; level < depth && frontier.size && included.size < limit; level++) {
        const next = new Set();
        for (const edge of graph.edges) {
          if (frontier.has(edge.source) && !included.has(edge.target)) next.add(edge.target);
          if (frontier.has(edge.target) && !included.has(edge.source)) next.add(edge.source);
          if (included.size + next.size >= limit) break;
        }
        for (const id of next) included.add(id);
        frontier = next;
      }
      return included;
    }

    // A request flow follows edges forward (route → middleware/controller → service → event).
    // 'listens' points from listener to event, so it is followed backwards to reach the listener.
    // Walking edges in both directions would hop through shared middleware into unrelated routes.
    function flowReachable(seedIds, depth, limit) {
      const included = new Set(seedIds);
      let frontier = new Set(seedIds);
      // Only the actions these routes call: method-level edges are labelled 'action()' or 'action($param)'.
      const actions = new Map();
      for (const edge of graph.edges) {
        if (edge.kind !== 'handles' || !included.has(edge.source)) continue;
        actions.set(edge.target, (actions.get(edge.target) || new Set()).add(edge.label));
      }
      const otherAction = edge => {
        const method = /^(\\w+)\\(/.exec(edge.label);
        return Boolean(method && actions.has(edge.source) && !actions.get(edge.source).has(method[1]));
      };
      for (let level = 0; level < depth && frontier.size && included.size < limit; level++) {
        const next = new Set();
        for (const edge of graph.edges) {
          if (otherAction(edge)) continue;
          const forward = edge.kind !== 'listens' && frontier.has(edge.source) ? edge.target : null;
          const backward = edge.kind === 'listens' && frontier.has(edge.target) ? edge.source : null;
          const neighbor = forward || backward;
          if (neighbor && !included.has(neighbor)) next.add(neighbor);
          if (included.size + next.size >= limit) break;
        }
        for (const id of next) included.add(id);
        frontier = next;
      }
      return included;
    }

    function overviewGraph() {
      const counts = new Map();
      for (const node of graph.nodes) counts.set(node.kind, (counts.get(node.kind) || 0) + 1);
      const nodes = [...counts.entries()].map(([kind, count]) => ({
        id: 'summary:' + kind,
        label: (kindLabels[kind] || kind) + ' · ' + count,
        kind,
        aggregateKind: kind,
        qualifiedName: count + ' architecture nodes',
        summary: 'This is a category summary. Open it to inspect only this Laravel layer and its direct connections.',
        syntax: 'LaraScura grouped these nodes by Laravel conventions, class names, inheritance, and source folders.',
        location: null
      }));
      const nodeKinds = new Map(graph.nodes.map(node => [node.id, node.kind]));
      const grouped = new Map();
      for (const edge of graph.edges) {
        const from = nodeKinds.get(edge.source);
        const to = nodeKinds.get(edge.target);
        if (!from || !to || from === to) continue;
        const fromLayer = layers.findIndex(kinds => kinds.includes(from));
        const toLayer = layers.findIndex(kinds => kinds.includes(to));
        const shouldSwap = fromLayer > toLayer || (fromLayer === toLayer && from.localeCompare(to) > 0);
        const sourceKind = shouldSwap ? to : from;
        const targetKind = shouldSwap ? from : to;
        const key = sourceKind + '->' + targetKind;
        const current = grouped.get(key) || { from: sourceKind, to: targetKind, count: 0 };
        current.count += 1;
        grouped.set(key, current);
      }
      const edges = [...grouped.values()].map(item => ({
        id: 'summary-edge:' + item.from + '->' + item.to,
        source: 'summary:' + item.from,
        target: 'summary:' + item.to,
        kind: 'calls',
        label: item.count + ' connections',
        explanation: (kindLabels[item.from] || item.from) + ' and ' + (kindLabels[item.to] || item.to) + ' have ' + item.count + ' mapped connections.',
        confidence: 'exact',
        aggregate: true,
        location: null
      }));
      return { nodes, edges, truncated: false };
    }

    function scopedGraph() {
      const query = search.value.trim().toLowerCase();
      if (query) {
        const matches = graph.nodes.filter(node =>
          [node.label, node.kind, node.qualifiedName].filter(Boolean).some(value => value.toLowerCase().includes(query))
        ).slice(0, 80);
        const ids = connected(matches.map(node => node.id), 1, 180);
        return {
          nodes: graph.nodes.filter(node => ids.has(node.id)),
          edges: graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)),
          truncated: matches.length >= 80
        };
      }
      if (scope.type === 'overview') return overviewGraph();
      if (scope.type === 'all') {
        const limit = 400;
        if (graph.nodes.length <= limit) return { nodes: graph.nodes, edges: graph.edges, truncated: false };
        const seeds = graph.nodes.filter(node => node.kind === 'route').slice(0, 80).map(node => node.id);
        if (!seeds.length) seeds.push(...graph.nodes.slice(0, 80).map(node => node.id));
        const ids = connected(seeds, 2, limit);
        for (const node of graph.nodes) {
          if (ids.size >= limit) break;
          ids.add(node.id);
        }
        return {
          nodes: graph.nodes.filter(node => ids.has(node.id)),
          edges: graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)),
          truncated: true
        };
      }

      let seeds = [];
      let depth = 1;
      let limit = 220;
      if (scope.type === 'kind') {
        const layerNodes = graph.nodes.filter(node => node.kind === scope.value);
        const visibleNodes = layerNodes.slice(0, 120);
        return {
          nodes: visibleNodes,
          edges: [],
          truncated: layerNodes.length > visibleNodes.length
        };
      } else if (scope.type === 'node') {
        const focused = graph.nodes.find(node => node.id === scope.value);
        if (!focused) return { nodes: [], edges: [], truncated: false };
        limit = 80;
        const ids = connected([focused.id], 1, limit);
        return {
          nodes: graph.nodes.filter(node => ids.has(node.id)),
          edges: graph.edges.filter(edge => edge.source === focused.id || edge.target === focused.id),
          truncated: ids.size >= limit
        };
      } else if (scope.type === 'module') {
        seeds = graph.nodes.filter(node => node.kind === 'route' && routeModule(node) === scope.value).map(node => node.id);
        depth = 4;
        limit = 240;
      } else if (scope.type === 'route') {
        seeds = [scope.value];
        depth = 5;
        limit = 120;
      }
      const ids = flowReachable(seeds, depth, limit);
      return {
        nodes: graph.nodes.filter(node => ids.has(node.id)),
        edges: graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)),
        truncated: ids.size >= limit
      };
    }

    // The order a request travels through a Laravel app; the navigator and spectrum follow it.
    const lifecycleOrder = ['route', 'middleware', 'request', 'controller', 'service', 'repository', 'provider', 'model', 'event', 'listener', 'job', 'command', 'class'];
    const methodColors = { GET: '#22c55e', HEAD: '#22c55e', POST: '#3b82f6', PUT: '#f59e0b', PATCH: '#f59e0b', DELETE: '#ef4444', OPTIONS: '#94a3b8', ANY: '#94a3b8' };

    function methodBadge(method) {
      const first = method.split('|')[0];
      const badge = text('span', method.includes('|') ? first + '+' : first, 'method');
      badge.style.setProperty('--method-color', methodColors[first] || '#94a3b8');
      badge.title = method;
      return badge;
    }

    function activateScope(nextScope) {
      scope = nextScope;
      selected = null;
      search.value = '';
      renderTree();
      render();
    }

    function isActiveScope(nextScope) {
      const focusedNode = scope.type === 'node' ? graph.nodes.find(node => node.id === scope.value) : null;
      return scopeKey(scope) === scopeKey(nextScope) || (nextScope.type === 'kind' && focusedNode?.kind === nextScope.value);
    }

    function navButton(label, count, nextScope, className) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nav-button ' + (className || '');
      if (isActiveScope(nextScope)) button.classList.add('active');
      button.title = label;
      if (className === 'route-item') {
        const parts = label.split(' ');
        const name = text('span', '', 'nav-label');
        name.append(methodBadge(parts[0]), document.createTextNode(parts.slice(1).join(' ')));
        button.append(name);
      } else {
        button.append(text('span', label, 'nav-label'));
      }
      if (count !== undefined) button.append(text('span', String(count), 'nav-count'));
      button.addEventListener('click', () => activateScope(nextScope));
      return button;
    }

    function orderedKinds(kindCounts) {
      return [...lifecycleOrder, ...[...kindCounts.keys()].filter(kind => !lifecycleOrder.includes(kind))]
        .filter(kind => kindCounts.get(kind));
    }

    function renderSpecimen(kindCounts) {
      const card = document.createElement('section');
      card.className = 'specimen';
      const overview = { type: 'overview' };
      const name = text('button', graph.projectName, 'specimen-name' + (isActiveScope(overview) ? ' active' : ''));
      name.type = 'button';
      name.title = 'Open the architecture overview';
      name.addEventListener('click', () => activateScope(overview));

      const stats = document.createElement('div');
      stats.className = 'specimen-stats';
      [[graph.nodes.length, 'nodes'], [graph.edges.length, 'links'], [kindCounts.get('route') || 0, 'routes']].forEach(([value, unit]) => {
        const stat = document.createElement('span');
        stat.append(text('strong', String(value)), document.createTextNode(' ' + unit));
        stats.append(stat);
      });

      const spectrum = document.createElement('div');
      spectrum.className = 'spectrum';
      spectrum.setAttribute('role', 'group');
      spectrum.setAttribute('aria-label', 'Project composition by architecture layer');
      orderedKinds(kindCounts).forEach(kind => {
        const count = kindCounts.get(kind);
        const segment = document.createElement('button');
        segment.type = 'button';
        segment.className = 'spectrum-segment';
        segment.style.flexGrow = String(count);
        segment.style.setProperty('--segment-color', colors[kind] || colors.class);
        segment.title = (kindLabels[kind] || kind) + ' · ' + count + ' (' + Math.max(1, Math.round(count / graph.nodes.length * 100)) + '%)';
        segment.setAttribute('aria-label', segment.title);
        segment.addEventListener('click', () => activateScope({ type: 'kind', value: kind }));
        spectrum.append(segment);
      });

      const caption = document.createElement('div');
      caption.className = 'spectrum-caption';
      caption.append(text('span', 'entry'), text('span', 'composition'), text('span', 'async'));
      card.append(text('div', 'LaraScura · specimen', 'specimen-eyebrow'), name, stats, spectrum, caption);
      return card;
    }

    function renderTree() {
      const kindCounts = new Map();
      for (const node of graph.nodes) kindCounts.set(node.kind, (kindCounts.get(node.kind) || 0) + 1);
      treeRoot.replaceChildren(renderSpecimen(kindCounts));

      const architecture = document.createElement('details');
      architecture.className = 'nav-section';
      architecture.open = scope.type !== 'module' && scope.type !== 'route' && scope.type !== 'all';
      architecture.append(text('summary', 'Architecture layers'), text('div', 'In the order a request travels', 'nav-caption'));
      const axis = document.createElement('div');
      axis.className = 'lifecycle';
      const largest = Math.max(1, ...kindCounts.values());
      orderedKinds(kindCounts).forEach(kind => {
        const count = kindCounts.get(kind);
        const nextScope = { type: 'kind', value: kind };
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer-button' + (isActiveScope(nextScope) ? ' active' : '');
        button.title = (kindLabels[kind] || kind) + ' · ' + count;
        button.style.setProperty('--layer-color', colors[kind] || colors.class);
        const bar = text('span', '', 'layer-bar');
        const fill = document.createElement('span');
        // Log scale keeps 5 events visible next to 900 routes.
        fill.style.width = Math.max(6, Math.round(Math.log(count + 1) / Math.log(largest + 1) * 100)) + '%';
        bar.append(fill);
        button.append(text('span', '', 'layer-dot'), text('span', kindLabels[kind] || kind, 'nav-label'), bar, text('span', String(count), 'layer-count'));
        button.addEventListener('click', () => activateScope(nextScope));
        axis.append(button);
      });
      architecture.append(axis);
      treeRoot.append(architecture);

      const moduleRoutes = new Map();
      for (const route of graph.nodes.filter(node => node.kind === 'route')) {
        const module = routeModule(route);
        const routes = moduleRoutes.get(module) || [];
        routes.push(route);
        moduleRoutes.set(module, routes);
      }
      const modules = document.createElement('details');
      modules.className = 'nav-section';
      modules.open = scope.type === 'module' || scope.type === 'route';
      modules.append(
        text('summary', 'Request flows'),
        text('div', moduleRoutes.size + ' modules · ' + (kindCounts.get('route') || 0) + ' routes', 'nav-caption')
      );
      [...moduleRoutes.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([module, routes]) => {
        const branch = document.createElement('details');
        branch.className = 'nav-module';
        branch.open = (scope.type === 'module' && scope.value === module)
          || (scope.type === 'route' && routes.some(route => route.id === scope.value));
        const summary = text('summary', module);
        summary.append(text('span', String(routes.length), 'nav-count'));
        branch.append(summary, navButton('All ' + module + ' flows', routes.length, { type: 'module', value: module }));
        routes.sort((left, right) => left.label.localeCompare(right.label)).forEach(route => {
          branch.append(navButton(route.label, undefined, { type: 'route', value: route.id }, 'route-item'));
        });
        modules.append(branch);
      });
      treeRoot.append(modules);

      const advanced = document.createElement('details');
      advanced.className = 'nav-section';
      advanced.open = scope.type === 'all';
      advanced.append(text('summary', 'Advanced'));
      advanced.append(navButton('All nodes', graph.nodes.length, { type: 'all' }));
      treeRoot.append(advanced);
    }

    function renderEdges(edges, visibleIds) {
      edgesRoot.replaceChildren();
      edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)).forEach(edge => {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) return;
        const nodeWidth = 172;
        const nodeHeight = 58;
        const fromCenter = { x: from.x + nodeWidth / 2, y: from.y + nodeHeight / 2 };
        const toCenter = { x: to.x + nodeWidth / 2, y: to.y + nodeHeight / 2 };
        const horizontal = Math.abs(toCenter.x - fromCenter.x) >= nodeWidth * .65;
        let d;
        if (horizontal) {
          const direction = toCenter.x >= fromCenter.x ? 1 : -1;
          const x1 = direction > 0 ? from.x + nodeWidth : from.x;
          const x2 = direction > 0 ? to.x : to.x + nodeWidth;
          const bend = Math.max(24, Math.abs(x2 - x1) * .42);
          d = 'M ' + x1 + ' ' + fromCenter.y + ' C ' + (x1 + direction * bend) + ' ' + fromCenter.y + ', ' + (x2 - direction * bend) + ' ' + toCenter.y + ', ' + x2 + ' ' + toCenter.y;
        } else {
          const direction = toCenter.y >= fromCenter.y ? 1 : -1;
          const y1 = direction > 0 ? from.y + nodeHeight : from.y;
          const y2 = direction > 0 ? to.y : to.y + nodeHeight;
          const bend = Math.max(18, Math.abs(y2 - y1) * .42);
          d = 'M ' + fromCenter.x + ' ' + y1 + ' C ' + fromCenter.x + ' ' + (y1 + direction * bend) + ', ' + toCenter.x + ' ' + (y2 - direction * bend) + ', ' + toCenter.x + ' ' + y2;
        }
        const group = document.createElementNS(svgNs, 'g');
        group.setAttribute('class', 'edge-group');
        group.setAttribute('data-edge-id', edge.id);
        group.setAttribute('tabindex', '0');
        const visibleLine = document.createElementNS(svgNs, 'path');
        visibleLine.setAttribute('class', 'edge-visible');
        visibleLine.setAttribute('d', d);
        const hit = document.createElementNS(svgNs, 'path');
        hit.setAttribute('class', 'edge-hit');
        hit.setAttribute('d', d);
        hit.addEventListener('click', () => showEdge(edge));
        group.addEventListener('keydown', event => { if (event.key === 'Enter') showEdge(edge); });
        group.append(visibleLine, hit);
        edgesRoot.appendChild(group);
      });
    }

    function makeDraggable(button, node, current, visibleIds) {
      let drag = null;
      let suppressClick = false;
      button.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        const origin = positions.get(node.id);
        if (!origin) return;
        drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: origin.x, y: origin.y, moved: false };
        button.setPointerCapture?.(event.pointerId);
      });
      button.addEventListener('pointermove', event => {
        if (!drag || (drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
        const dx = (event.clientX - drag.startX) / zoomLevel;
        const dy = (event.clientY - drag.startY) / zoomLevel;
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        drag.moved = true;
        suppressClick = true;
        button.classList.add('dragging');
        const next = { x: Math.max(8, drag.x + dx), y: Math.max(46, drag.y + dy) };
        positions.set(node.id, next);
        button.style.left = next.x + 'px';
        button.style.top = next.y + 'px';
        const width = Math.max(1100, next.x + 220, ...[...positions.values()].map(position => position.x + 220));
        const height = Math.max(760, next.y + 110, ...[...positions.values()].map(position => position.y + 110));
        stage.style.width = width + 'px';
        stage.style.height = height + 'px';
        edgesRoot.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
        renderEdges(current.edges, visibleIds);
      });
      const finishDrag = event => {
        if (!drag || (drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
        if (drag.moved) {
          manualPositions.set(layoutKey(node.id), positions.get(node.id));
          persistUiState();
        }
        button.classList.remove('dragging');
        button.releasePointerCapture?.(event.pointerId);
        drag = null;
      };
      button.addEventListener('pointerup', finishDrag);
      button.addEventListener('pointercancel', finishDrag);
      button.addEventListener('click', event => {
        if (suppressClick) {
          suppressClick = false;
          event.preventDefault();
          return;
        }
        showNode(node);
      });
    }

    function render() {
      if (!graph) return;
      nodesRoot.replaceChildren();
      edgesRoot.replaceChildren();
      positions = new Map();
      const current = scopedGraph();
      const visible = current.nodes;
      const visibleIds = new Set(visible.map(node => node.id));
      const columnWidth = 230;
      const rowHeight = 86;
      let maxRows = 1;
      const compactColumns = scope.type !== 'overview' && scope.type !== 'all';
      let renderedColumn = 0;

      layers.forEach((kinds, column) => {
        const group = visible.filter(node => kinds.includes(node.kind));
        if (compactColumns && !group.length) return;
        const layoutColumn = compactColumns ? renderedColumn++ : column;
        maxRows = Math.max(maxRows, group.length);
        const label = text('div', kinds.join(' / '), 'column-label');
        label.style.left = (34 + layoutColumn * columnWidth) + 'px';
        nodesRoot.appendChild(label);
        group.forEach((node, row) => {
          const automatic = { x: 34 + layoutColumn * columnWidth, y: 54 + row * rowHeight };
          const custom = manualPositions.get(layoutKey(node.id));
          const x = custom?.x ?? automatic.x;
          const y = custom?.y ?? automatic.y;
          positions.set(node.id, { x, y });
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'node' + (selected === node.id ? ' active' : '');
          button.style.left = x + 'px';
          button.style.top = y + 'px';
          button.style.setProperty('--node-color', colors[node.kind] || colors.class);
          button.dataset.nodeId = node.id;
          button.append(text('span', node.kind, 'node-kind'), text('span', node.label, 'node-label'));
          makeDraggable(button, node, current, visibleIds);
          nodesRoot.appendChild(button);
        });
      });

      const width = Math.max(1100, 70 + layers.length * columnWidth, ...[...positions.values()].map(position => position.x + 220));
      const height = Math.max(760, 100 + maxRows * rowHeight, ...[...positions.values()].map(position => position.y + 110));
      stage.style.width = width + 'px';
      stage.style.height = height + 'px';
      edgesRoot.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      renderEdges(current.edges, visibleIds);

      const labels = {
        overview: 'Architecture overview',
        module: 'Module · ' + (scope.value || ''),
        route: graph.nodes.find(node => node.id === scope.value)?.label || 'Request flow',
        kind: kindLabels[scope.value] || scope.value,
        node: 'Connections · ' + (graph.nodes.find(node => node.id === scope.value)?.label || 'Selected node'),
        all: 'All nodes'
      };
      scopeName.textContent = search.value.trim() ? 'Search results' : labels[scope.type];
      scopeNote.textContent = current.truncated
        ? 'Result limited for readability'
        : scope.type === 'kind' && !search.value.trim()
          ? visible.length + ' nodes · select one to show direct connections'
          : visible.length + ' nodes · ' + current.edges.length + ' connections';
      stats.textContent = visible.length + '/' + graph.nodes.length + ' nodes';
    }

    function section(title, body, code) {
      const wrapper = document.createElement('section');
      wrapper.className = 'section';
      wrapper.append(text('h3', title), text('p', body));
      if (code) wrapper.append(text('pre', code, 'code'));
      return wrapper;
    }

    function sourceButton(kind, id) {
      const button = text('button', 'Open source beside', 'tool-button source-button');
      button.type = 'button';
      button.addEventListener('click', () => vscode.postMessage({
        type: kind === 'node' ? 'openNode' : 'openEdge',
        [kind === 'node' ? 'nodeId' : 'edgeId']: id
      }));
      return button;
    }

    function showNode(node) {
      if (node.aggregateKind) {
        scope = { type: 'kind', value: node.aggregateKind };
        selected = null;
        renderTree();
        render();
        return;
      }
      if (scope.type === 'kind' || scope.type === 'node') {
        scope = { type: 'node', value: node.id };
        renderTree();
      }
      selected = node.id;
      render();
      openInspector(node.label);
      detailContent.replaceChildren();
      const badge = text('span', node.kind, 'badge');
      badge.style.setProperty('--detail-color', colors[node.kind] || colors.class);
      detailContent.style.setProperty('--detail-color', colors[node.kind] || colors.class);
      const incoming = graph.edges.filter(edge => edge.target === node.id);
      const outgoing = graph.edges.filter(edge => edge.source === node.id);
      detailContent.append(
        badge,
        text('h2', node.label),
        text('p', node.qualifiedName || '', 'qualified'),
        degreeMeter(incoming.length, outgoing.length),
        section('What is this?', node.summary)
      );
      if (incoming.length || outgoing.length) detailContent.append(connectionSection(incoming, outgoing));
      detailContent.append(
        section('Laravel syntax', node.syntax, node.location.preview),
        section('Source', node.location.file + ':' + node.location.line),
        sourceButton('node', node.id)
      );
    }

    function degreeMeter(incomingCount, outgoingCount) {
      const largest = Math.max(1, incomingCount, outgoingCount);
      const side = (count, direction) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'degree-side ' + direction;
        const bar = text('span', '', 'degree-bar');
        const fill = document.createElement('span');
        fill.style.width = Math.round(count / largest * 100) + '%';
        bar.append(fill);
        wrapper.append(text('span', direction + ' ' + count), bar);
        return wrapper;
      };
      const meter = document.createElement('div');
      meter.className = 'degree';
      meter.title = incomingCount + ' incoming and ' + outgoingCount + ' outgoing connections';
      meter.append(side(incomingCount, 'in'), text('span', '', 'degree-core'), side(outgoingCount, 'out'));
      return meter;
    }

    function connectionSection(incoming, outgoing) {
      const limit = 14;
      const nodesById = new Map(graph.nodes.map(candidate => [candidate.id, candidate]));
      const rows = [
        ...outgoing.map(edge => ({ edge, other: nodesById.get(edge.target), arrow: '→' })),
        ...incoming.map(edge => ({ edge, other: nodesById.get(edge.source), arrow: '←' }))
      ].filter(row => row.other);
      const list = document.createElement('div');
      list.className = 'connection-list';
      rows.slice(0, limit).forEach(({ edge, other, arrow }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'connection';
        button.title = edge.explanation;
        const kind = text('span', edge.kind, 'connection-kind');
        kind.style.setProperty('--kind-color', colors[other.kind] || colors.class);
        button.append(text('span', arrow, 'connection-dir'), kind, text('span', other.label, 'connection-target'));
        button.addEventListener('click', () => focusNode(other.id));
        list.append(button);
      });
      if (rows.length > limit) list.append(text('div', '+' + (rows.length - limit) + ' more in the map', 'connection-more'));
      const wrapper = document.createElement('section');
      wrapper.className = 'section';
      wrapper.append(text('h3', 'Connections'), list);
      return wrapper;
    }

    function showEdge(edge) {
      selected = null;
      render();
      const displayed = scopedGraph().nodes;
      const source = displayed.find(node => node.id === edge.source);
      const target = displayed.find(node => node.id === edge.target);
      openInspector((source?.label || '?') + ' → ' + (target?.label || '?'));
      detailContent.replaceChildren();
      detailContent.style.removeProperty('--detail-color');
      const content = [
        text('span', edge.kind, 'badge'),
        text('h2', (source?.label || '?') + ' → ' + (target?.label || '?')),
        text('p', edge.confidence === 'exact' ? 'Exact static match' : 'Inferred static match', 'qualified'),
        section('Why are they connected?', edge.explanation),
        section('Syntax evidence', edge.label, edge.location?.preview)
      ];
      if (edge.location) {
        content.push(
          section('Source', edge.location.file + ':' + edge.location.line),
          sourceButton('edge', edge.id)
        );
      }
      detailContent.append(...content);
    }

    function focusNode(nodeId) {
      const node = graph?.nodes.find(candidate => candidate.id === nodeId);
      if (!node) return;
      search.value = '';
      scope = node.kind === 'route' ? { type: 'route', value: node.id } : { type: 'node', value: node.id };
      renderTree();
      showNode(node);
    }

    window.addEventListener('message', event => {
      if (event.data?.type === 'focus') {
        focusNode(event.data.nodeId);
        return;
      }
      if (event.data?.type !== 'graph') return;
      graph = event.data.graph;
      document.title = 'LaraScura — ' + graph.projectName;
      renderTree();
      render();
      if (graph.warnings.length) {
        const warning = text('div', graph.warnings.length + ' dynamic or unresolved connection(s) were kept as warnings instead of being guessed.', 'warning');
        detailContent.prepend(warning);
      }
    });
    search.addEventListener('input', render);
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('resetLayout').addEventListener('click', () => {
      const prefix = (search.value.trim() ? 'search:' + search.value.trim().toLowerCase() : scopeKey(scope)) + '|';
      manualPositions = new Map([...manualPositions.entries()].filter(([key]) => !key.startsWith(prefix)));
      persistUiState();
      render();
    });
    document.getElementById('minimizeDetail').addEventListener('click', () => setInspectorState('minimized'));
    document.getElementById('closeDetail').addEventListener('click', () => setInspectorState('closed'));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && inspectorState !== 'closed') setInspectorState('closed');
    });
    document.getElementById('zoom').addEventListener('input', event => {
      zoomLevel = Number(event.target.value) / 100;
      stage.style.transform = 'scale(' + zoomLevel + ')';
    });
    restoreUiState();
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
