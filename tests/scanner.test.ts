import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { codeLensEntries, nodeAtCursor } from '../src/codeLensModel.js';
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
    FileType: { File: 1, Directory: 2 },
    env: { language: 'en' },
    workspace: {
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      // A small glob matcher (**, *, {a,b}) so every pattern the scanner asks for runs against the fixture.
      findFiles: async (include: { base: { fsPath: string }; pattern: string }, exclude?: { pattern: string }) => {
        const toRegExp = (glob: string): RegExp => {
          let source = '';
          for (let index = 0; index < glob.length; index += 1) {
            const character = glob[index]!;
            if (character === '*' && glob[index + 1] === '*') {
              source += '(?:.*/)?';
              index += glob[index + 2] === '/' ? 2 : 1;
            } else if (character === '*') source += '[^/]*';
            else if (character === '{') source += '(?:';
            else if (character === '}') source += ')';
            else if (character === ',') source += '|';
            else source += /[.+?^$()[\]|\\]/.test(character) ? `\\${character}` : character;
          }
          return new RegExp(`^${source}$`);
        };
        const included = toRegExp(include.pattern);
        const excluded = exclude ? toRegExp(exclude.pattern) : undefined;
        return walk(include.base.fsPath)
          .map((file) => ({ file, relative: path.relative(include.base.fsPath, file).split(path.sep).join('/') }))
          .filter(({ relative }) => included.test(relative) && !excluded?.test(relative))
          .map(({ file }) => uri(file));
      },
      fs: {
        readFile: async (target: { fsPath: string }) => fs.readFileSync(target.fsPath),
        stat: async (target: { fsPath: string }) => ({ type: fs.statSync(target.fsPath).isDirectory() ? 2 : 1 }),
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

  it('scans PSR-4 directories and modules but skips factories', async () => {
    const graph = await scanFixture();

    expect(graph.sourceDirectories).toEqual(['app', 'Modules', 'routes', 'src/Domain']);
    expect(graph.nodes.find((node) => node.qualifiedName === 'Domain\\Billing\\InvoiceService')?.external).toBeUndefined();
    expect(graph.nodes.some((node) => node.qualifiedName === 'Database\\Factories\\OrderFactory')).toBe(false);

    const blogRoute = graph.nodes.find((node) => node.kind === 'route' && node.label === 'GET /blog');
    expect(graph.edges.find((edge) => edge.source === blogRoute?.id)?.target).toBe(
      'controller:Modules\\Blog\\Http\\Controllers\\PostController',
    );
  });
});

describe('Inertia on a fixture project', () => {
  it('maps Vue pages and links controllers and Route::inertia to them', async () => {
    const graph = await scanFixture();
    const pages = graph.nodes.filter((node) => node.kind === 'page');

    expect(pages.filter((node) => !node.external).map((node) => node.label).sort()).toEqual(['About', 'Dashboard', 'Orders/Index']);
    expect(graph.pageFramework).toBe('Vue');
    expect(pages.find((node) => node.label === 'Orders/Index')?.syntax).toBe('Props declared with defineProps: orders, filters?');

    const renders = graph.edges.filter((edge) => edge.kind === 'renders');
    expect(renders.map((edge) => [edge.source.split(':').slice(0, 2).join(':').replace(/:\/.*/, ''), edge.target, edge.label]).sort()).toEqual([
      ['controller:App\\Http\\Controllers\\DashboardController', 'page:Dashbaord', '__invoke()'],
      ['controller:App\\Http\\Controllers\\OrderController', 'page:Orders/Index', 'index()'],
      ['route', 'page:About', 'renders'],
    ]);
    // The misspelled page exists only as a reference.
    expect(pages.find((node) => node.label === 'Dashbaord')?.external).toBe(true);
  });

  it('marks pages nothing renders as unused', async () => {
    const graph = await scanFixture();
    // DashboardController asks for the misspelled "Dashbaord", so the real Dashboard page is never rendered.
    expect(graph.nodes.filter((node) => node.unused).map((node) => node.label)).toEqual(['Dashboard']);
    expect(graph.findings.filter((finding) => finding.code === 'unused-page').map((finding) => path.basename(finding.file))).toEqual(['Dashboard.vue']);
  });

  it('reports the missing page and the misspelled prop with quick fixes', async () => {
    const graph = await scanFixture();
    const inertia = graph.findings.filter((finding) => finding.code === 'missing-page' || finding.code === 'inertia-props');

    expect(inertia.map((finding) => [finding.code, path.basename(finding.file), finding.token, finding.replacement])).toEqual([
      ['missing-page', 'DashboardController.php', 'Dashbaord', 'Dashboard'],
      ['inertia-props', 'OrderController.php', 'ordres', 'orders'],
    ]);
  });
});

describe('CodeLens model on a fixture project', () => {
  const fixtureFile = (relative: string) => path.join(fixtureRoot, relative);
  const lensesFor = async (relative: string) => {
    const graph = await scanFixture();
    const file = fixtureFile(relative);
    return codeLensEntries(graph, file, fs.readFileSync(file, 'utf8'));
  };

  it('shows the handling controller action above each route declaration', async () => {
    const lenses = await lensesFor('routes/web.php');

    expect(lenses.filter((lens) => lens.line === 7).map((lens) => lens.title)).toEqual([
      '→ OrderController@store',
      '$(type-hierarchy) Show flow',
      '$(play) Journey',
    ]);
    expect(lenses.find((lens) => lens.line === 7)?.command).toEqual({
      id: 'larascura.openMethod',
      file: fixtureFile('app/Http/Controllers/OrderController.php'),
      method: 'store',
    });
  });

  it('shows routes and middleware above controller actions', async () => {
    const lenses = await lensesFor('app/Http/Controllers/OrderController.php');

    expect(lenses.find((lens) => lens.line === 12)?.title).toBe(
      '$(globe) POST /orders · web, auth, throttle:10,1',
    );
    expect(lenses.find((lens) => lens.line === 17)?.title).toBe('$(globe) GET /orders/{order} · web, auth, admin');
    expect(lenses.find((lens) => lens.line === 10)?.title).toMatch(/^\$\(type-hierarchy\) \d+ connections$/);
  });

  it('does not put lenses for referenced-only nodes into the referencing file', async () => {
    const lenses = await lensesFor('routes/web.php');

    // Framework middleware nodes point at routes/web.php but are not defined there.
    expect(lenses.some((lens) => lens.title.includes('connection'))).toBe(false);
  });

  it('points Inertia renders at their Vue page, and flags a missing page', async () => {
    const orderLenses = await lensesFor('app/Http/Controllers/OrderController.php');
    expect(orderLenses.find((lens) => lens.line === 24)).toEqual(expect.objectContaining({
      title: '$(browser) → Orders/Index',
      command: { id: 'larascura.openFile', file: fixtureFile('resources/js/Pages/Orders/Index.vue'), line: 2 },
    }));

    const dashboardLenses = await lensesFor('app/Http/Controllers/DashboardController.php');
    expect(dashboardLenses.find((lens) => lens.line === 9)?.title).toBe('$(warning) Dashbaord page not found');
  });

  it('picks the route above the cursor, or the class defined in the file', async () => {
    const graph = await scanFixture();

    expect(nodeAtCursor(graph, fixtureFile('routes/web.php'), 8)?.label).toBe('GET /orders/{order}');
    expect(nodeAtCursor(graph, fixtureFile('routes/web.php'), 1)?.label).toBe('POST /orders');
    expect(nodeAtCursor(graph, fixtureFile('app/Listeners/SendReceipt.php'), 1)?.id).toBe(
      'listener:App\\Listeners\\SendReceipt',
    );
  });
});
