# LaraScura

**See how Laravel works.**

LaraScura is a local-first VS Code extension that visualizes Laravel architecture, follows request flows, and explains the PHP/Laravel syntax that created every connection.

It is designed for developers who want to understand Laravel—not merely browse a dependency graph.

## First release

- Detects reusable Laravel projects through `artisan` and `composer.json`
- Maps routes to controllers and actions
- Shows route middleware
- Detects constructor dependency injection
- Maps Eloquent relationships
- Detects jobs and events dispatched from classes
- Maps service-container bindings
- Classifies controllers, services, repositories, models, jobs, events, listeners, providers, and commands
- Opens the exact source line from every node and connection
- Explains Laravel concepts in English or Turkish
- Watches `app/` and `routes/` for changes
- Packages as a normal installable VSIX
- Starts with a compact architecture overview instead of a full-graph hairball
- Navigates through request-flow modules, individual routes, and architecture layers

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

- Node.js 20+
- npm
- VS Code 1.95+

~~~bash
npm install
npm run check
npm run compile
~~~

Press `F5` in VS Code to launch an Extension Development Host.

## Package and install

~~~bash
npm run package:vsix
code --install-extension larascura-0.1.0.vsix
~~~

Then open any Laravel project and run:

> LaraScura: Open Architecture Map

## Static-analysis boundaries

Laravel permits dynamic routes, runtime service-container bindings, macros, package discovery, and magic methods. LaraScura reports exact matches when syntax is statically resolvable and keeps dynamic handlers as warnings instead of inventing connections.

The scanner will become more precise over time while preserving this rule: **uncertainty must be visible**.

## Roadmap

- Route-group prefix and inherited middleware resolution
- Event-to-listener registration mapping
- Laravel middleware alias resolution
- Method-level request journey view
- Form Request, Policy, Resource, Notification, Mail, and Observer nodes
- Laravel-version-aware learning cards
- Multi-project workspace comparison

## License

MIT
