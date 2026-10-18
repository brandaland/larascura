# Changelog

## 0.6.5

- Open the map without the Command Palette: a LaraScura button in the editor title bar of PHP files, and **Open Architecture Map** and **Doctor** rows at the top of the LaraScura sidebar. The Doctor row shows the latest count and opens the Problems panel. Sidebar layers now follow the request lifecycle, like the map.
- Class names written with a namespace prefix (`Models\User`, an aliased `Books\Ledger`) now resolve the way PHP does: through an imported first segment, otherwise the current namespace.
- When a project exceeds the 10,000-file scan limit, the map shows a *Partial scan* notice and the status bar says *(partial)*, so an incomplete map is never mistaken for a complete one.
- README: how LaraScura is built, and a note that it is for every learner, at any age.

## 0.6.4

- Fixed the map falling apart in narrow panels, for example after *Open source beside*. The toolbar no longer wraps or pushes the page wider than the panel, labels in the navigator fit, and the Inspector opens as a right-hand drawer instead of a bottom sheet that overflowed.
- While the drawer is open, the map is laid out in the part of the panel it leaves visible, so no node hides behind it.

## 0.6.3

- The pages layer is named after the framework it detects: *Vue Pages*, *React Pages* or *Svelte Pages*, and page nodes read `VUE PAGE`, so it is clear at a glance that this is what users see.
- Hovering a layer in the navigator explains it in one line, for example *Middleware: checks that run before the controller*.

## 0.6.2

- Hovered and selected nodes now take a light tint of their own color instead of a second outline. Keyboard focus keeps its outline.

## 0.6.1

- LaraScura Doctor lists Inertia pages that no controller, route or closure renders as *probably unused* tips. It stays quiet when a page name is passed in a variable, and leaves child components under `Pages/components` alone.
- Unused pages carry a small dashed `unused` badge on the map and a note in the Inspector.

## 0.6.0

- **Inertia + Vue support.** Inertia pages appear as their own *Pages* layer, right after controllers, so a request flow now ends where users see it: `GET /orders → auth → OrderController@index → Orders/Index`. The pages folder is read from `import.meta.glob(...)` in your app entry, with `resources/js/Pages` and `resources/js/pages` as fallbacks.
- Controllers, route closures and `Route::inertia('/about', 'About')` are linked to the pages they render. Selecting a page shows the props it declares, with required ones highlighted.
- CodeLens above every `Inertia::render(...)` opens the Vue page it returns.
- LaraScura Doctor checks Inertia:
  - pages that do not exist (`Inertia::render('Users/Idnex')` → *Did you mean "Users/Index"?*), and page names that only match when letter case is ignored, which fail on Linux servers;
  - props whose name does not match what the page declares (`'ordres'` → `orders`), with a quick fix;
  - required props that no render passes and shared data does not provide.
- Page props are read from `defineProps<{...}>()`, `defineProps<Props>()` with a local interface or type, `withDefaults(...)`, runtime object and array declarations, and the Options API. Shared props come from `HandleInertiaRequests::share()`.
- Doctor stays quiet when props are built dynamically (payload classes, variables), when a render sends a subset of another render's props (a partial reload), and when shared data cannot be read completely. Child components kept under `Pages/components` are not shown as pages.

## 0.5.4

- Added a small medical cross to the Doctor badge in the Inspector.

## 0.5.3

- LaraScura Doctor now tells reachable breakage from leftovers. A broken route is marked **Reachable** when a view, script or class links to it by route name or URL (including hand-built URLs such as `"/currency/change/" + currency`), **Probably unused** when nothing does, and **External caller** for API routes and webhooks, which are called from outside the app. The linking places appear under the finding in the Problems panel and in the Doctor list, which now sorts reachable problems first.
- Closure routes are understood instead of reported. A closure that hands over to a class (`app(X::class)->method()`, `(new X)->method()`, or a typed `X $x` followed by `$x->method()`) links the route to `X@method`; other closures are shown as handled inline.
- Fixed closures being cut off at their first `);`, which dropped middleware chained after them and could link a route to the wrong class.
- Routes now carry their full name, including group prefixes such as `admin.` and resource names such as `users.index`.
- The ambiguous class name note only lists names that were actually referenced without a namespace, instead of every pair of classes that share a short name.

## 0.5.2

- Fixed a minimized Inspector that could not be restored: the minimize button now toggles to restore, and clicking the minimized title bar opens it again. The minimized bar shows the Doctor count.
- Added a **Doctor** button to the map toolbar whenever there are findings, so they stay reachable even with the Inspector closed.

## 0.5.1

- Linked routes declared inside `Route::controller(X::class)->group(...)` to their controller, so `Route::get('/', 'index')` maps to `X@index`. Nested controller groups use the innermost controller. On a 900-route production app this connected 323 more routes.
- Expanded resource routes that name their controller as a string (`Route::resource('tags', 'TagController')`) and the plural `Route::resources([...])` / `Route::apiResources([...])` helpers.
- Fixed the route parameter of prefixed resources: `Route::resource('admin/users', ...)` now uses `{user}` instead of `{admin/user}`.
- LaraScura Doctor now checks those routes too, so missing methods behind controller groups are reported.

## 0.5.0

- Added **LaraScura Doctor**, static checks that catch Laravel mistakes before a page is opened:
  - route actions missing from their controller (`'indx'` → *Did you mean "index"?*) and single-action controllers without `__invoke()`;
  - resource routes whose controller lacks some actions, with advice to add `->except([...])`;
  - controllers and related models that do not exist;
  - misspelled middleware aliases (`'atuh'` → `auth`);
  - views missing from `resources/views`;
  - routes defined twice in the same file, where only the last one runs;
  - namespaces whose letter case does not match their PSR-4 folder.
- Findings appear in the Problems panel and as squiggles in the editor. Safe typos come with a one-click quick fix, and the status bar shows how many possible mistakes there are.
- The warning box in the map is now a clickable Doctor summary that lists every finding and opens it in the editor. Connections that could not be resolved are listed too.
- Doctor stays quiet when an action could come from a trait, an unknown parent class, or `__call()`, and when views come from extra view paths. Turn it off with `larascura.doctor`.
- Class names are matched case-insensitively, as PHP does.

## 0.4.1

- The map now fits the visible area without shrinking nodes: layers that do not fit wrap into another row, long layers spread over spare columns, and the layout follows window resizes and zoom.
- Added a right-click menu. On a node: show its request flow or direct connections, or open its source. On the canvas: arrange to fit the screen, zoom to 100%, or go back to the overview.

## 0.4.0

- Added CodeLens: routes show the controller action that handles them, controller actions show every route and middleware that reaches them, and each class shows its connection count.
- Redesigned the navigator: a project specimen card with a clickable composition spectrum, architecture layers ordered along the request lifecycle with proportional bars, and colored HTTP method badges on every route.
- Redesigned the Inspector: an incoming/outgoing connection meter and a clickable list of direct connections that moves the map to the connected node.
- Added **LaraScura: Reveal in Architecture Map** (editor context menu and Command Palette) to focus the map on the route under the cursor or the class in the current file.
- Scanned every PSR-4 autoload directory from `composer.json` and the `Modules/` folder, so domain folders and modular projects are mapped; factories, seeders, and tests stay out of the map.
- Recognized route files inside modules, such as `Modules/Blog/routes/web.php`.
- Fixed request-flow views pulling in unrelated routes through shared middleware such as `auth:sanctum`. A flow now follows connections forward from its route and only includes the controller action that route calls.
- Ignored PHP built-in classes such as `Closure` and `DateTime` instead of drawing them as architecture nodes, and resolved fully qualified names like `\DateTimeInterface` correctly.
- Built the graph quietly in the background on startup so CodeLens works before the map is opened. Turn CodeLens off with `larascura.codeLens`.

## 0.3.0

- Mapped controller method injection: Form Requests appear as their own layer (`validates`), type-hinted models show route model binding (`resolves`), and services injected into actions or `handle()` are linked.
- Connected listeners to events through `handle(Event $event)` type-hints (Laravel event discovery) and explicit `$listen` / `Event::listen` registrations.
- Resolved middleware aliases from `bootstrap/app.php`, `app/Http/Kernel.php`, and Laravel's built-in aliases; `web` and `api` are explained as middleware groups and unknown aliases are reported as warnings.
- Recognized class-based route middleware such as `->middleware(EnsureAdmin::class)`.
- Read parameter lists with balanced-bracket scanning so nested defaults, attributes, nullable and union types no longer break dependency detection.
- Added an end-to-end scanner test against a fixture Laravel project.
- Linked the Marketplace page to the GitHub repository and issue tracker.

## 0.2.3

- Added natural search terms such as mind map, architecture map, diagram, schema, dependency graph, and request flow to improve Marketplace discovery.
- Opened exact source locations beside the architecture map so the current visual context stays visible.
- Simplified overview connections by merging reciprocal layer relationships and routing lines through the nearest node edges.
- Made architecture-layer views progressive: layers start with their own nodes, then selecting one reveals only its direct relationships.

## 0.2.2

- Polished the extension icon for better visibility at Marketplace and sidebar sizes.
- Ignored scalar constructor parameters instead of rendering them as class nodes.
- Corrected source-line navigation for multiline constructor injection.
- Added `Route::match`, `Route::resource`, and `Route::apiResource` parsing.
- Applied common nested route-group prefixes and middleware to child routes.
- Distinguished event-class dispatches from queued jobs and ignored dispatch facades.
- Stopped ambiguous short class names from silently linking to the wrong class.
- Deferred multi-root project selection until the user opens LaraScura.
- Limited the advanced all-nodes view to keep very large projects responsive.
- Kept multi-method routes such as `PUT|PATCH` in their real navigator module instead of a module named after the HTTP methods.
- Documented the current static-analysis limitations in the README.
- Marked the extension as a Marketplace preview while the scanner matures.

## 0.2.1

- Fixed the architecture webview failing to start after the category-tree update.
- Added a DOM runtime regression test for webview startup and overview rendering.

## 0.2.0

- Added hierarchical request-flow, module, route, and architecture navigation
- Added a compact aggregate overview instead of rendering every node by default
- Added focused neighborhood graphs with readability limits
- Kept the complete graph available under Advanced → All nodes

## 0.1.0

- Initial local-only Laravel architecture scanner
- Interactive architecture map
- Source navigation
- English and Turkish syntax explanations
- Workspace Trust and strict Webview CSP
