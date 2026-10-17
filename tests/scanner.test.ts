import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { LaravelScanner } from '../src/scanner.js';

const fixtureRoot = path.join(__dirname, 'fixtures', 'laravel-app');

const walk = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

vi.mock('vscode', () => {
  const uri = (fsPath: string) => ({ fsPath });
  return {
    Uri: {
      file: uri,
      joinPath: (base: { fsPath: string }, ...parts: string[]) => uri(path.join(base.fsPath, ...parts)),
    },
    RelativePattern: class {
      constructor(public base: { fsPath: string }, public pattern: string) {}
    },
    CancellationError: class extends Error {},
    env: { language: 'en' },
    workspace: {
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      // The scanner asks for {app,routes}/**/*.php; mirror that against the fixture.
      findFiles: async (include: { base: { fsPath: string } }) =>
        ['app', 'routes']
          .flatMap((folder) => walk(path.join(include.base.fsPath, folder)))
          .filter((file) => file.endsWith('.php'))
          .map(uri),
      fs: {
        readFile: async (target: { fsPath: string }) => fs.readFileSync(target.fsPath),
      },
    },
  };
});

const scanFixture = () => new LaravelScanner().scan({ fsPath: fixtureRoot } as never);

describe('Laravel scanner on a fixture project', () => {
  it('links form requests, route model binding, and method-injected services', async () => {
    const graph = await scanFixture();
    const controller = 'controller:App\\Http\\Controllers\\OrderController';
    const edge = (kind: string, target: string) =>
      graph.edges.find((candidate) => candidate.kind === kind && candidate.source === controller && candidate.target === target);

    expect(edge('validates', 'request:App\\Http\\Requests\\StoreOrderRequest')?.label).toBe('store()');
    expect(edge('resolves', 'model:App\\Models\\Order')?.label).toBe('show($order)');
    expect(edge('injects', 'service:App\\Services\\Checkout')?.label).toBe('store()');
    expect(graph.nodes.some((node) => node.qualifiedName === 'Illuminate\\Http\\Request')).toBe(false);
  });

  it('connects listeners to events through discovery and provider registration without duplicates', async () => {
    const graph = await scanFixture();
    const listens = graph.edges.filter((edge) => edge.kind === 'listens');

    expect(listens.map((edge) => [edge.source, edge.target]).sort()).toEqual([
      ['listener:App\\Listeners\\SendReceipt', 'event:App\\Events\\OrderPlaced'],
      ['listener:App\\Listeners\\UpdateStock', 'event:App\\Events\\OrderPlaced'],
    ]);
    expect(listens.find((edge) => edge.source.endsWith('SendReceipt'))?.explanation).toContain('handle()');
    expect(listens.find((edge) => edge.source.endsWith('UpdateStock'))?.explanation).toContain('service provider');
  });

  it('resolves app, framework, and group middleware aliases and warns about unknown ones', async () => {
    const graph = await scanFixture();
    const middlewareOf = (uri: string) => {
      const route = graph.nodes.find((node) => node.kind === 'route' && node.label.endsWith(uri));
      return graph.edges
        .filter((edge) => edge.kind === 'middleware' && edge.source === route?.id)
        .map((edge) => graph.nodes.find((node) => node.id === edge.target));
    };

    const show = middlewareOf('/orders/{order}');
    expect(show.map((node) => node?.id)).toEqual([
      'middleware:web',
      'middleware:Illuminate\\Auth\\Middleware\\Authenticate',
      'middleware:App\\Http\\Middleware\\EnsureAdmin',
    ]);
    expect(show[0]?.syntax).toContain('middleware group');

    const store = middlewareOf('/orders').map((node) => node?.qualifiedName);
    expect(store).toContain('Illuminate\\Routing\\Middleware\\ThrottleRequests');

    expect(graph.warnings).toContain("Middleware alias 'mystery' could not be resolved to a class statically.");
  });
});
