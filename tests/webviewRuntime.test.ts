import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { createGraphHtml } from '../src/graphPanel.js';
import type { ArchitectureGraph } from '../src/types.js';

describe('LaraScura architecture webview', () => {
  it('renders the category tree and aggregate overview after receiving a graph', async () => {
    const errors: string[] = [];
    const messages: unknown[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error.message));
    virtualConsole.on('error', (...values) => errors.push(values.join(' ')));

    const dom = new JSDOM(createGraphHtml('test-nonce'), {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole,
      beforeParse(window) {
        window.addEventListener('error', (event) => errors.push(event.message));
        let webviewState: unknown = undefined;
        Object.assign(window, {
          acquireVsCodeApi: () => ({
            postMessage: (message: unknown) => messages.push(message),
            getState: () => webviewState,
            setState: (state: unknown) => { webviewState = state; },
          }),
        });
      },
    });
    const graph: ArchitectureGraph = {
      projectName: 'example/app',
      root: '/workspace/example',
      generatedAt: new Date(0).toISOString(),
      warnings: [],
      nodes: [
        {
          id: 'route:orders',
          label: 'GET /orders',
          kind: 'route',
          location: { file: '/workspace/example/routes/web.php', line: 10 },
          summary: 'Route',
          syntax: 'Route syntax',
        },
        {
          id: 'controller:orders',
          label: 'OrderController',
          qualifiedName: 'App\\Http\\Controllers\\OrderController',
          kind: 'controller',
          location: { file: '/workspace/example/app/Http/Controllers/OrderController.php', line: 5 },
          summary: 'Controller',
          syntax: 'Controller syntax',
        },
      ],
      edges: [
        {
          id: 'handles:orders',
          source: 'route:orders',
          target: 'controller:orders',
          kind: 'handles',
          label: 'index',
          location: { file: '/workspace/example/routes/web.php', line: 10 },
          explanation: 'The route is handled by the controller.',
          confidence: 'exact',
        },
      ],
    };

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'graph', graph },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dom.window.document.scripts).toHaveLength(1);
    expect(dom.window.document.scripts[0]?.textContent?.length).toBeGreaterThan(100);
    expect(messages).toContainEqual({ type: 'ready' });
    expect(errors).toEqual([]);
    expect(dom.window.document.querySelector('#tree')?.textContent).toContain('Request flows');
    expect(dom.window.document.querySelector('#tree')?.textContent).toContain('Architecture layers');
    expect(dom.window.document.querySelectorAll('.node')).toHaveLength(2);
    expect(dom.window.document.querySelector('#scopeName')?.textContent).toBe('Architecture overview');
    expect(dom.window.document.querySelector('#resetLayout')).not.toBeNull();
    expect(dom.window.document.querySelector('#minimizeDetail')).not.toBeNull();
    expect(dom.window.document.querySelector('#closeDetail')).not.toBeNull();

    (dom.window.document.querySelector('#minimizeDetail') as { click(): void } | null)?.click();
    expect(dom.window.document.querySelector('#detail')?.classList.contains('minimized')).toBe(true);
    expect(dom.window.document.querySelector('#workspace')?.classList.contains('inspector-collapsed')).toBe(true);

    (dom.window.document.querySelector('#closeDetail') as { click(): void } | null)?.click();
    expect(dom.window.document.querySelector('#detail')?.classList.contains('closed')).toBe(true);

    const controllerSummary = [...dom.window.document.querySelectorAll('.node')]
      .find((node) => node.textContent?.includes('Controllers')) as { click(): void } | undefined;
    controllerSummary?.click();
    const controllerNode = [...dom.window.document.querySelectorAll('.node')]
      .find((node) => node.textContent?.includes('OrderController')) as { click(): void } | undefined;
    controllerNode?.click();
    expect(dom.window.document.querySelector('#detail')?.classList.contains('closed')).toBe(false);
    expect(dom.window.document.querySelector('#detailTitle')?.textContent).toBe('OrderController');

    dom.window.close();
  });
});
