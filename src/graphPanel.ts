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

  public static show(
    context: vscode.ExtensionContext,
    graph: ArchitectureGraph,
    onRefresh: () => Promise<ArchitectureGraph>,
  ): GraphPanel {
    if (GraphPanel.current) {
      GraphPanel.current.graph = graph;
      GraphPanel.current.panel.reveal(vscode.ViewColumn.One);
      GraphPanel.current.postGraph();
      return GraphPanel.current;
    }

    GraphPanel.current = new GraphPanel(context, graph, onRefresh);
    return GraphPanel.current;
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
        retainContextWhenHidden: true,
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
          this.postGraph();
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
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    const line = Math.max(0, Math.min(location.line - 1, document.lineCount - 1));
    const range = document.lineAt(line).range;
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private html(): string {
    const token = nonce();
    return `<!doctype html>
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
    .zoom { width: 100px; accent-color: #7c3aed; }
    .stats { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 12px; white-space: nowrap; }
    .workspace { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 340px; }
    .viewport { position: relative; overflow: auto; background-image: radial-gradient(var(--vscode-panel-border) 0.7px, transparent 0.7px); background-size: 18px 18px; }
    .stage { position: relative; min-width: 1100px; min-height: 760px; transform-origin: top left; }
    .edges { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
    .edge-visible { stroke: var(--vscode-descriptionForeground); stroke-width: 1.2; opacity: .42; fill: none; }
    .edge-hit { stroke: transparent; stroke-width: 14; fill: none; pointer-events: stroke; cursor: pointer; }
    .edge-group:hover .edge-visible, .edge-group:focus .edge-visible { stroke: #a78bfa; stroke-width: 2.4; opacity: 1; }
    .node { position: absolute; width: 172px; min-height: 58px; padding: 9px 10px; text-align: left; color: var(--vscode-foreground); background: var(--vscode-editorWidget-background); border: 1px solid var(--node-color); border-left-width: 4px; border-radius: 8px; box-shadow: 0 3px 12px rgba(0,0,0,.16); cursor: pointer; }
    .node:hover, .node:focus-visible, .node.active { outline: 2px solid var(--node-color); outline-offset: 2px; }
    .node-kind { display: block; margin-bottom: 4px; color: var(--node-color); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .node-label { display: block; overflow: hidden; font-size: 12px; font-weight: 650; line-height: 1.3; text-overflow: ellipsis; }
    .column-label { position: absolute; top: 18px; width: 172px; color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-align: center; text-transform: uppercase; }
    .detail { min-width: 0; overflow-y: auto; padding: 18px; border-left: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
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
    .hidden { display: none !important; }
    @media (max-width: 850px) {
      .workspace { grid-template-columns: 1fr; }
      .detail { position: absolute; right: 0; bottom: 0; width: min(88vw, 340px); max-height: 55vh; border-top: 1px solid var(--vscode-panel-border); box-shadow: -8px -8px 24px rgba(0,0,0,.2); }
      .stats { display: none; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="toolbar">
      <div class="brand"><span class="brand-mark">L</span><span>LaraScura</span></div>
      <input id="search" class="search" type="search" placeholder="Filter routes, classes, models…" aria-label="Filter architecture nodes">
      <button id="refresh" class="tool-button" type="button">Refresh</button>
      <input id="zoom" class="zoom" type="range" min="55" max="135" value="100" aria-label="Graph zoom">
      <span id="stats" class="stats">Waiting for scan…</span>
    </header>
    <div class="workspace">
      <main id="viewport" class="viewport" aria-label="Laravel architecture graph">
        <div id="stage" class="stage"><svg id="edges" class="edges" aria-hidden="true"></svg><div id="nodes"></div></div>
      </main>
      <aside id="detail" class="detail" aria-live="polite">
        <div class="detail-empty"><strong>Explore how Laravel works.</strong><br>Select a node or connection to see why it exists, which syntax created it, and where it lives in your project.</div>
      </aside>
    </div>
  </div>
  <script nonce="${token}">
    const vscode = acquireVsCodeApi();
    const colors = {
      route: '#22c55e', middleware: '#f59e0b', controller: '#3b82f6',
      service: '#8b5cf6', repository: '#a855f7', model: '#ef4444',
      job: '#64748b', event: '#eab308', listener: '#14b8a6',
      provider: '#ec4899', command: '#06b6d4', class: '#94a3b8'
    };
    const layers = [
      ['route'], ['middleware'], ['controller'], ['service', 'repository', 'provider'],
      ['model', 'class'], ['event', 'job', 'listener', 'command']
    ];
    let graph = null;
    let positions = new Map();
    let selected = null;
    const stage = document.getElementById('stage');
    const nodesRoot = document.getElementById('nodes');
    const edgesRoot = document.getElementById('edges');
    const detail = document.getElementById('detail');
    const search = document.getElementById('search');
    const stats = document.getElementById('stats');
    const svgNs = 'http://www.w3.org/2000/svg';

    function text(tag, value, className) {
      const element = document.createElement(tag);
      element.textContent = value ?? '';
      if (className) element.className = className;
      return element;
    }

    function render() {
      if (!graph) return;
      nodesRoot.replaceChildren();
      edgesRoot.replaceChildren();
      positions = new Map();
      const query = search.value.trim().toLowerCase();
      const visible = graph.nodes.filter(node =>
        !query || [node.label, node.kind, node.qualifiedName].filter(Boolean).some(value => value.toLowerCase().includes(query))
      );
      const visibleIds = new Set(visible.map(node => node.id));
      const columnWidth = 230;
      const rowHeight = 86;
      let maxRows = 1;

      layers.forEach((kinds, column) => {
        const group = visible.filter(node => kinds.includes(node.kind));
        maxRows = Math.max(maxRows, group.length);
        const label = text('div', kinds.join(' / '), 'column-label');
        label.style.left = (34 + column * columnWidth) + 'px';
        nodesRoot.appendChild(label);
        group.forEach((node, row) => {
          const x = 34 + column * columnWidth;
          const y = 54 + row * rowHeight;
          positions.set(node.id, { x, y });
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'node' + (selected === node.id ? ' active' : '');
          button.style.left = x + 'px';
          button.style.top = y + 'px';
          button.style.setProperty('--node-color', colors[node.kind] || colors.class);
          button.dataset.nodeId = node.id;
          button.append(text('span', node.kind, 'node-kind'), text('span', node.label, 'node-label'));
          button.addEventListener('click', () => showNode(node));
          nodesRoot.appendChild(button);
        });
      });

      const width = Math.max(1100, 70 + layers.length * columnWidth);
      const height = Math.max(760, 100 + maxRows * rowHeight);
      stage.style.width = width + 'px';
      stage.style.height = height + 'px';
      edgesRoot.setAttribute('viewBox', '0 0 ' + width + ' ' + height);

      graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target)).forEach(edge => {
        const from = positions.get(edge.source);
        const to = positions.get(edge.target);
        if (!from || !to) return;
        const x1 = from.x + 172;
        const y1 = from.y + 29;
        const x2 = to.x;
        const y2 = to.y + 29;
        const bend = Math.max(32, Math.abs(x2 - x1) * .42);
        const d = 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + bend) + ' ' + y1 + ', ' + (x2 - bend) + ' ' + y2 + ', ' + x2 + ' ' + y2;
        const group = document.createElementNS(svgNs, 'g');
        group.setAttribute('class', 'edge-group');
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

      stats.textContent = visible.length + '/' + graph.nodes.length + ' nodes · ' + graph.edges.length + ' connections';
    }

    function section(title, body, code) {
      const wrapper = document.createElement('section');
      wrapper.className = 'section';
      wrapper.append(text('h3', title), text('p', body));
      if (code) wrapper.append(text('pre', code, 'code'));
      return wrapper;
    }

    function sourceButton(kind, id) {
      const button = text('button', 'Open exact source line', 'tool-button source-button');
      button.type = 'button';
      button.addEventListener('click', () => vscode.postMessage({
        type: kind === 'node' ? 'openNode' : 'openEdge',
        [kind === 'node' ? 'nodeId' : 'edgeId']: id
      }));
      return button;
    }

    function showNode(node) {
      selected = node.id;
      render();
      detail.replaceChildren();
      const badge = text('span', node.kind, 'badge');
      badge.style.setProperty('--detail-color', colors[node.kind] || colors.class);
      detail.append(
        badge,
        text('h2', node.label),
        text('p', node.qualifiedName || '', 'qualified'),
        section('What is this?', node.summary),
        section('Laravel syntax', node.syntax, node.location.preview),
        section('Source', node.location.file + ':' + node.location.line),
        sourceButton('node', node.id)
      );
    }

    function showEdge(edge) {
      selected = null;
      render();
      const source = graph.nodes.find(node => node.id === edge.source);
      const target = graph.nodes.find(node => node.id === edge.target);
      detail.replaceChildren();
      detail.append(
        text('span', edge.kind, 'badge'),
        text('h2', (source?.label || '?') + ' → ' + (target?.label || '?')),
        text('p', edge.confidence === 'exact' ? 'Exact static match' : 'Inferred static match', 'qualified'),
        section('Why are they connected?', edge.explanation),
        section('Syntax evidence', edge.label, edge.location.preview),
        section('Source', edge.location.file + ':' + edge.location.line),
        sourceButton('edge', edge.id)
      );
    }

    window.addEventListener('message', event => {
      if (event.data?.type !== 'graph') return;
      graph = event.data.graph;
      document.title = 'LaraScura — ' + graph.projectName;
      render();
      if (graph.warnings.length) {
        const warning = text('div', graph.warnings.length + ' dynamic or unresolved connection(s) were kept as warnings instead of being guessed.', 'warning');
        detail.prepend(warning);
      }
    });
    search.addEventListener('input', render);
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    document.getElementById('zoom').addEventListener('input', event => {
      const value = Number(event.target.value) / 100;
      stage.style.transform = 'scale(' + value + ')';
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
