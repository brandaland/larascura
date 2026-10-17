# Changelog

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
