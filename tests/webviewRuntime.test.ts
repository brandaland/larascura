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
      sourceDirectories: ['app', 'routes'],
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

    const sourceButton = dom.window.document.querySelector('.source-button') as { click(): void; textContent: string | null } | null;
    expect(sourceButton?.textContent).toBe('Open source beside');
    sourceButton?.click();
    expect(messages).toContainEqual({ type: 'openNode', nodeId: 'controller:orders' });

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'focus', nodeId: 'route:orders' },
    }));
    expect(dom.window.document.querySelector('#scopeName')?.textContent).toBe('GET /orders');
    expect(dom.window.document.querySelector('#detailTitle')?.textContent).toBe('GET /orders');
    expect(dom.window.document.querySelector('.node.active')?.textContent).toContain('GET /orders');

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {
      data: { type: 'focus', nodeId: 'controller:orders' },
    }));
    expect(dom.window.document.querySelector('#scopeName')?.textContent).toBe('Connections · OrderController');
    expect(errors).toEqual([]);

    dom.window.close();
  });

  it('groups multi-method route labels under their real module', async () => {
    const dom = new JSDOM(createGraphHtml('test-nonce'), {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(window) {
        let webviewState: unknown = undefined;
        Object.assign(window, {
          acquireVsCodeApi: () => ({
            postMessage: () => undefined,
            getState: () => webviewState,
            setState: (state: unknown) => { webviewState = state; },
          }),
        });
      },
    });
    const route = (id: string, label: string): ArchitectureGraph['nodes'][number] => ({
      id,
      label,
      kind: 'route',
      location: { file: '/workspace/example/routes/web.php', line: 1 },
      summary: 'Route',
      syntax: 'Route syntax',
    });
    const graph: ArchitectureGraph = {
      projectName: 'example/app',
      root: '/workspace/example',
      sourceDirectories: ['app', 'routes'],
      generatedAt: new Date(0).toISOString(),
      warnings: [],
      edges: [],
      nodes: [
        route('route:index', 'GET /admin/posts'),
        route('route:update', 'PUT|PATCH /admin/posts/{post}'),
        route('route:preview', 'GET|POST /admin/preview'),
      ],
    };

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const modules = [...dom.window.document.querySelectorAll('.nav-module > summary')]
      .map((element) => element.firstChild?.textContent);
    expect(modules).toEqual(['admin']);

    dom.window.close();
  });

  it('merges reciprocal overview relationships and routes them between the nearest node edges', async () => {
    const dom = new JSDOM(createGraphHtml('test-nonce'), {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(window) {
        Object.assign(window, {
          acquireVsCodeApi: () => ({
            postMessage: () => undefined,
            getState: () => undefined,
            setState: () => undefined,
          }),
        });
      },
    });
    const node = (id: string, kind: ArchitectureGraph['nodes'][number]['kind']): ArchitectureGraph['nodes'][number] => ({
      id,
      label: id,
      kind,
      location: { file: '/workspace/example/app/example.php', line: 1 },
      summary: kind,
      syntax: kind,
    });
    const graph: ArchitectureGraph = {
      projectName: 'example/app',
      root: '/workspace/example',
      sourceDirectories: ['app', 'routes'],
      generatedAt: new Date(0).toISOString(),
      warnings: [],
      nodes: [node('controller', 'controller'), node('service', 'service')],
      edges: [
        {
          id: 'controller-to-service', source: 'controller', target: 'service', kind: 'calls', label: 'calls',
          location: { file: '/workspace/example/app/example.php', line: 1 }, explanation: 'calls', confidence: 'exact',
        },
        {
          id: 'service-to-controller', source: 'service', target: 'controller', kind: 'injects', label: 'injects',
          location: { file: '/workspace/example/app/example.php', line: 2 }, explanation: 'injects', confidence: 'exact',
        },
      ],
    };

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overviewEdges = [...dom.window.document.querySelectorAll('.edge-group')];
    expect(overviewEdges).toHaveLength(1);
    expect(overviewEdges[0]?.getAttribute('data-edge-id')).toBe('summary-edge:controller->service');
    expect(overviewEdges[0]?.querySelector('.edge-visible')?.getAttribute('d')).toMatch(/^M 666 83 C .* 724 83$/);

    dom.window.close();
  });

  it('shows a quiet layer first and only the selected node direct relationships after selection', async () => {
    const dom = new JSDOM(createGraphHtml('test-nonce'), {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
      beforeParse(window) {
        Object.assign(window, {
          acquireVsCodeApi: () => ({
            postMessage: () => undefined,
            getState: () => undefined,
            setState: () => undefined,
          }),
        });
      },
    });
    const node = (id: string, label: string, kind: ArchitectureGraph['nodes'][number]['kind']): ArchitectureGraph['nodes'][number] => ({
      id,
      label,
      kind,
      location: { file: '/workspace/example/app/example.php', line: 1 },
      summary: kind,
      syntax: kind,
    });
    const edge = (id: string, source: string, target: string): ArchitectureGraph['edges'][number] => ({
      id,
      source,
      target,
      kind: 'calls',
      label: 'calls',
      location: { file: '/workspace/example/app/example.php', line: 1 },
      explanation: 'calls',
      confidence: 'exact',
    });
    const graph: ArchitectureGraph = {
      projectName: 'example/app',
      root: '/workspace/example',
      sourceDirectories: ['app', 'routes'],
      generatedAt: new Date(0).toISOString(),
      warnings: [],
      nodes: [
        node('job:mail', 'SendMailJob', 'job'),
        node('job:sms', 'SendSmsJob', 'job'),
        node('controller:orders', 'OrderController', 'controller'),
        node('service:sms', 'SmsService', 'service'),
      ],
      edges: [
        edge('dispatches:mail', 'controller:orders', 'job:mail'),
        edge('dispatches:sms', 'service:sms', 'job:sms'),
      ],
    };

    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { type: 'graph', graph } }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const jobsSummary = [...dom.window.document.querySelectorAll('.node')]
      .find((element) => element.textContent?.includes('Jobs')) as { click(): void } | undefined;
    jobsSummary?.click();

    expect([...dom.window.document.querySelectorAll('.node')].map(element => element.textContent)).toEqual([
      expect.stringContaining('SendMailJob'),
      expect.stringContaining('SendSmsJob'),
    ]);
    expect(dom.window.document.querySelectorAll('.edge-group')).toHaveLength(0);
    expect(dom.window.document.querySelector('#scopeNote')?.textContent).toContain('select one to show direct connections');

    const mailJob = [...dom.window.document.querySelectorAll('.node')]
      .find((element) => element.textContent?.includes('SendMailJob')) as { click(): void } | undefined;
    mailJob?.click();

    const focusedLabels = [...dom.window.document.querySelectorAll('.node')].map(element => element.textContent);
    expect(focusedLabels).toHaveLength(2);
    expect(focusedLabels).toEqual(expect.arrayContaining([
      expect.stringContaining('SendMailJob'),
      expect.stringContaining('OrderController'),
    ]));
    expect(focusedLabels.join(' ')).not.toContain('SmsService');
    expect(focusedLabels.join(' ')).not.toContain('SendSmsJob');
    expect(dom.window.document.querySelectorAll('.edge-group')).toHaveLength(1);
    expect(dom.window.document.querySelector('#scopeName')?.textContent).toBe('Connections · SendMailJob');

    dom.window.close();
  });
});
