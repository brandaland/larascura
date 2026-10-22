# LaraScura

**See how Laravel works.**

LaraScura is a local-first VS Code extension that visualizes Laravel architecture, follows request flows, and explains the PHP/Laravel syntax that created every connection.

It is designed for developers who want to understand Laravel—not merely browse a dependency graph.

## Why LaraScura exists

LaraScura was created for people who understand systems better through flows and relationships than through punctuation and syntax. It is free because learning tools like this should be accessible to every learner, at any age.

> **Free forever. No telemetry, no subscriptions, and no hidden costs. Just learn, build, and pass it on.**

## Features

- Detects reusable Laravel projects through `artisan` and `composer.json`
- Maps routes to controllers and actions
- Shows route middleware
- Understands common route groups, `Route::match`, resource routes, and API resource routes
- Detects constructor and controller-action dependency injection
- Shows Form Request validation and route model binding for each controller action
- Links listeners to the events they handle, through event discovery or provider registration
- Resolves middleware aliases (`auth`, `throttle`, your own `admin`) to the real middleware class
- Maps Eloquent relationships
- Detects jobs and events dispatched from classes
- Maps service-container bindings
- Classifies controllers, services, repositories, models, jobs, events, listeners, providers, and commands
- **Request Journey:** pick a route and step through how Laravel handles it, from middleware to the page the user sees, with each step explained in plain words
- Opens the exact source line from every node and connection
- **Inertia + Vue:** maps every page, shows which controller renders it and the props it expects, and catches missing pages and mismatched props
- **LaraScura Doctor** finds missing controller methods and views, misspelled middleware, missing models, and duplicate routes, with "Did you mean…?" quick fixes
- Shows CodeLens above routes, controller actions, and classes, and reveals the current file in the map
- Scans PSR-4 autoload directories and `Modules/`, not only `app/`
- Explains Laravel concepts in English or Turkish
- Watches every scanned directory for changes
- Packages as a normal installable VSIX
- Starts with a compact architecture overview instead of a full-graph hairball
- Navigates through request-flow modules, individual routes, and architecture layers
- Lets you move nodes into a layout that matches how you think
- Provides a collapsible Inspector that reopens whenever you select a node or connection

## Privacy and security

LaraScura:

- does not send source code, graph data, or telemetry anywhere;
- does not load remote scripts, fonts, styles, or images;
- does not run `artisan`, PHP, Composer, shell commands, or project code;
- uses static source analysis only;
- is disabled in untrusted workspaces;
- limits source navigation to the selected Laravel project;
- gives its Webview no local-resource access and uses a strict Content Security Policy.

See the bundled SECURITY.md file for the threat model.

## Development

Requirements:

- Node.js 22.22+
- npm
- VS Code 1.95+

~~~bash
npm install
npm run check
npm run compile
~~~

Press `F5` in VS Code to launch an Extension Development Host.

## Install

Install **LaraScura** from the Visual Studio Code Marketplace, then open a Laravel project and run:

> LaraScura: Open Architecture Map

Marketplace identifier: `ooll.larascura`

## Package locally

~~~bash
npm run package:vsix
code --install-extension larascura-0.8.0.vsix
~~~

## Static-analysis boundaries

Laravel permits dynamic routes, runtime service-container bindings, macros, package discovery, and magic methods. LaraScura reports exact matches when syntax is statically resolvable and keeps dynamic handlers as warnings instead of inventing connections.

The scanner will become more precise over time while preserving this rule: **uncertainty must be visible**.

## Known limitations

LaraScura is an early release. It maps what it can resolve statically and stays silent instead of guessing. It does not yet resolve:

- String controller names (`'TagController'`, `'TagController@index'`) are linked only when exactly one class has that short name, because Laravel resolves them through a runtime namespace.
- Classes that share a short name across namespaces. These are deliberately left unlinked rather than connected to the wrong class.
- Middleware aliases registered by packages at runtime, and anything registered through macros or dynamic container bindings.

A missing connection means the syntax was not statically resolvable — not that the connection does not exist.

## Roadmap

LaraScura's goal is to make Laravel easier to learn by showing how a request really travels through an app, and why each piece is there.

### Next: 1.0, *See a request travel*

- ✅ **Request Journey** — shipped in `0.7.0`: pick a route and step through middleware, validation, controller, services, events and the page, each step explained in plain words.
- **Learning mode.** Show only the flow you are studying, with explanations written for people new to Laravel.
- **Explain Selection, rebuilt.** Fifty common Laravel patterns explained in context, each linked to the official documentation.
- **Coverage.** Blade views and Livewire components; Policy, Observer, Notification, Mail, API Resource and scheduled-task nodes; dependencies resolved through `app()` and facades.

### Doctor as a teacher

- Every finding explains the Laravel rule behind it, not just what is wrong.
- **Security radar:** routes that change data without authentication, mass-assignable models, login routes without throttling.
- **Database view** from migrations, with checks such as a `hasMany` relation whose foreign key does not exist.

### Later

- **Change impact:** see which routes and pages a branch touches before you merge.
- Export the map as Mermaid for documentation and pull requests.
- Laravel-version-aware explanations.
- Translations contributed by the community.
- Incremental scanning for very large projects.

### What will not change

Local-first, no telemetry, no code execution, free forever, and uncertainty always shown instead of guessed.

## How LaraScura is built

LaraScura started from a designer's wish to see how Laravel fits together. It is built with AI coding assistants (OpenAI Codex and Anthropic Claude), guided and tested on real Laravel projects by its author.

## License

LaraScura is free and open-source software released under the MIT License. See the included `LICENSE` file. You may use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the software, provided that the copyright and license notice remain included.
