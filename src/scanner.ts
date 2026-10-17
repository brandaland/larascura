import * as path from 'node:path';
import * as vscode from 'vscode';
import { ambiguousClassNames, createClassNameIndex, resolveClassName } from './classResolver.js';
import { kindSummary, parseMiddlewareAliases, parsePhpClass, parseRoutes } from './phpParser.js';
import { diagnose, linkRouteFindings } from './doctor.js';
import { isRouteFile, phpGlob, sourceDirectories } from './projectLayout.js';
import type {
  ArchitectureEdge,
  ArchitectureGraph,
  ArchitectureNode,
  NodeKind,
  ParsedClass,
  SourceLocation,
} from './types.js';

const decode = (data: Uint8Array): string => new TextDecoder('utf-8').decode(data);
const normalize = (value: string): string => value.replaceAll('\\', '/');
const nodeId = (kind: NodeKind, name: string): string => `${kind}:${name}`;
const linePreview = (source: string, line: number): string => source.split(/\r?\n/)[line - 1]?.trim() ?? '';

const language = (): 'en' | 'tr' => {
  const configured = vscode.workspace.getConfiguration('larascura').get<string>('explanationLanguage', 'auto');
  if (configured === 'tr' || configured === 'en') return configured;
  return vscode.env.language.toLowerCase().startsWith('tr') ? 'tr' : 'en';
};

// Aliases Laravel registers itself (Illuminate\Foundation\Configuration\Middleware::defaultAliases).
const frameworkMiddlewareAliases: Record<string, string> = {
  auth: 'Illuminate\\Auth\\Middleware\\Authenticate',
  'auth.basic': 'Illuminate\\Auth\\Middleware\\AuthenticateWithBasicAuth',
  'auth.session': 'Illuminate\\Session\\Middleware\\AuthenticateSession',
  'cache.headers': 'Illuminate\\Http\\Middleware\\SetCacheHeaders',
  can: 'Illuminate\\Auth\\Middleware\\Authorize',
  guest: 'Illuminate\\Auth\\Middleware\\RedirectIfAuthenticated',
  'password.confirm': 'Illuminate\\Auth\\Middleware\\RequirePassword',
  precognitive: 'Illuminate\\Foundation\\Http\\Middleware\\HandlePrecognitiveRequests',
  signed: 'Illuminate\\Routing\\Middleware\\ValidateSignature',
  throttle: 'Illuminate\\Routing\\Middleware\\ThrottleRequests',
  verified: 'Illuminate\\Auth\\Middleware\\EnsureEmailIsVerified',
};
const middlewareGroups = new Set(['web', 'api']);

const inferredKind = (name: string): NodeKind => {
  if (/Controller$/.test(name)) return 'controller';
  if (/\\Http\\Middleware\\/.test(name)) return 'middleware';
  if (/\\Http\\Requests\\/.test(name)) return 'request';
  if (/Repository$/.test(name)) return 'repository';
  if (/Service$/.test(name)) return 'service';
  if (/Job$/.test(name)) return 'job';
  if (/Event$/.test(name)) return 'event';
  if (/Listener$/.test(name)) return 'listener';
  if (/Provider$/.test(name)) return 'provider';
  if (/Command$/.test(name)) return 'command';
  if (/Middleware$/.test(name)) return 'middleware';
  return 'class';
};

const edgeExplanation = (
  kind: ArchitectureEdge['kind'],
  source: string,
  target: string,
  detail: string,
  lang: 'en' | 'tr',
): string => {
  const tr = lang === 'tr';
  const messages: Record<ArchitectureEdge['kind'], string> = {
    handles: tr
      ? `${source}, ${target} isteğini karşılayan controller metodudur. Laravel route eşleşmesinden sonra bu metodu çağırır.`
      : `${source} is handled by ${target}. Laravel calls this controller method after route matching.`,
    middleware: tr
      ? `${target}, ${source} çalışmadan önce isteği denetler. Tanım: ${detail}.`
      : `${target} checks the request before ${source} runs. Declaration: ${detail}.`,
    injects: tr
      ? `${source}, ${target} bağımlılığını type-hint ile ister; service container nesneyi oluşturup enjekte eder.`
      : `${source} type-hints ${target}; the service container constructs and injects it.`,
    validates: tr
      ? `${source}, ${detail} parametresini ${target} ile type-hint eder; Laravel doğrulama ve authorize() kontrolünü metot çalışmadan önce yapar. Doğrulama başarısız olursa metot hiç çağrılmaz.`
      : `${source} type-hints ${target} for ${detail}; Laravel runs its validation rules and authorize() before the method executes. If validation fails, the method is never called.`,
    resolves: tr
      ? `Route model binding: Laravel URL'deki {${detail}} parametresiyle veritabanından ${target} kaydını bulup metoda verir. Kayıt yoksa otomatik 404 döner.`
      : `Route model binding: Laravel uses the {${detail}} URL parameter to load a ${target} record and passes it to the method. A missing record returns a 404 automatically.`,
    calls: tr ? `${source}, ${target} sınıfını kullanır.` : `${source} uses ${target}.`,
    dispatches: tr
      ? `${source}, ${target} job’ını dispatch eder; iş queue yapılandırmasına göre yürütülür.`
      : `${source} dispatches the ${target} job; queue configuration controls its execution.`,
    fires: tr
      ? `${source}, ${target} event’ini yayınlar; kayıtlı listener’lar bağımsız olarak tepki verir.`
      : `${source} fires the ${target} event; registered listeners can react independently.`,
    listens: detail === 'registered'
      ? tr
        ? `${source}, ${target} event’ini dinler. Bu eşleşme bir service provider içinde açıkça kaydedilmiştir.`
        : `${source} listens for ${target}. The pairing is registered explicitly in a service provider.`
      : tr
        ? `${source}, ${detail}() metodunda ${target} type-hint ettiği için bu event’i dinler. Laravel event discovery bu imzadan eşleşmeyi otomatik kurar.`
        : `${source} listens for ${target} because its ${detail}() method type-hints it. Laravel's event discovery builds the pairing from this signature.`,
    relates: tr
      ? `${source} ile ${target} arasında ${detail} Eloquent ilişkisi tanımlanmıştır.`
      : `${source} defines a ${detail} Eloquent relationship with ${target}.`,
    binds: tr
      ? `Container, ${source} istendiğinde ${target} oluşturacak şekilde bağlanmıştır.`
      : `The container is configured to build ${target} whenever ${source} is requested.`,
  };
  return messages[kind];
};

export const findLaravelRoots = async (): Promise<vscode.Uri[]> => {
  const roots: vscode.Uri[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const composerUri = vscode.Uri.joinPath(folder.uri, 'composer.json');
    const artisanUri = vscode.Uri.joinPath(folder.uri, 'artisan');
    try {
      const composer = decode(await vscode.workspace.fs.readFile(composerUri));
      await vscode.workspace.fs.stat(artisanUri);
      if (/laravel\/framework|laravel\/laravel/.test(composer)) roots.push(folder.uri);
    } catch {
      // A workspace folder that is not a Laravel root is expected.
    }
  }
  return roots;
};

export const chooseLaravelRoot = async (): Promise<vscode.Uri | undefined> => {
  const roots = await findLaravelRoots();
  if (roots.length <= 1) return roots[0];

  const choice = await vscode.window.showQuickPick(
    roots.map((root) => ({ label: path.basename(root.fsPath), description: root.fsPath, root })),
    { placeHolder: 'Choose the Laravel project LaraScura should analyze' },
  );
  return choice?.root;
};

export const scanDirectories = async (root: vscode.Uri): Promise<string[]> => {
  let composer: string | undefined;
  try {
    composer = decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'composer.json')));
  } catch {
    composer = undefined;
  }
  let hasModules = false;
  try {
    hasModules = (await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, 'Modules'))).type === vscode.FileType.Directory;
  } catch {
    hasModules = false;
  }
  return sourceDirectories(composer, hasModules);
};

/**
 * View names under resources/views (users/index.blade.php → users.index). Returns undefined when
 * config/view.php adds other view paths, because a missing view could then live elsewhere.
 */
const viewNamesOf = async (root: vscode.Uri, token?: vscode.CancellationToken): Promise<Set<string> | undefined> => {
  try {
    const config = decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'config', 'view.php')));
    const paths = config.match(/['"]paths['"]\s*=>\s*\[([^\]]*)\]/)?.[1] ?? '';
    if (paths.replace(/resource_path\(\s*['"]views['"]\s*\)/, '').replace(/[\s,]/g, '')) return undefined;
  } catch {
    // No config/view.php means the default resources/views path.
  }
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, 'resources', 'views'));
    if (stat.type !== vscode.FileType.Directory) return undefined;
  } catch {
    return undefined;
  }
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, 'resources/views/**/*.php'), undefined, 20000, token);
  const viewsRoot = normalize(path.join(root.fsPath, 'resources', 'views'));
  return new Set(files.map((uri) => normalize(uri.fsPath)
    .slice(viewsRoot.length + 1)
    .replace(/(\.blade)?\.php$/, '')
    .replaceAll('/', '.')));
};

export class LaravelScanner {
  public async scan(root: vscode.Uri, token?: vscode.CancellationToken): Promise<ArchitectureGraph> {
    const lang = language();
    const includeRepositories = vscode.workspace
      .getConfiguration('larascura')
      .get<boolean>('includeRepositories', true);
    const directories = await scanDirectories(root);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, phpGlob(directories)),
      new vscode.RelativePattern(root, '{vendor,storage,bootstrap/cache,node_modules}/**'),
      10000,
      token,
    );
    const nodes = new Map<string, ArchitectureNode>();
    const classes = new Map<string, { parsed: ParsedClass; source: string; file: string }>();
    const routeFiles: Array<{ file: string; source: string }> = [];
    const warnings: string[] = [];
    const middlewareAliases = new Map<string, { target: string; location?: SourceLocation }>(
      Object.entries(frameworkMiddlewareAliases).map(([alias, target]) => [alias, { target }]),
    );
    const collectMiddlewareAliases = (file: string, source: string): void => {
      if (!/middlewareAliases|routeMiddleware|->alias\s*\(/.test(source)) return;
      for (const alias of parseMiddlewareAliases(source)) {
        middlewareAliases.set(alias.alias, {
          target: alias.target,
          location: { file, line: alias.line, preview: linePreview(source, alias.line) },
        });
      }
    };
    try {
      const bootstrapUri = vscode.Uri.joinPath(root, 'bootstrap', 'app.php');
      collectMiddlewareAliases(bootstrapUri.fsPath, decode(await vscode.workspace.fs.readFile(bootstrapUri)));
    } catch {
      // Laravel 10 and older register aliases in app/Http/Kernel.php instead.
    }

    for (const uri of files) {
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      const source = decode(await vscode.workspace.fs.readFile(uri));
      const relative = normalize(path.relative(root.fsPath, uri.fsPath));
      if (isRouteFile(relative)) routeFiles.push({ file: uri.fsPath, source });

      collectMiddlewareAliases(uri.fsPath, source);
      const parsed = parsePhpClass(relative, source);
      if (!parsed) continue;
      if (!includeRepositories && parsed.kind === 'repository') parsed.kind = 'service';

      classes.set(parsed.qualifiedName, { parsed, source, file: uri.fsPath });
      nodes.set(nodeId(parsed.kind, parsed.qualifiedName), {
        id: nodeId(parsed.kind, parsed.qualifiedName),
        label: parsed.shortName,
        qualifiedName: parsed.qualifiedName,
        kind: parsed.kind,
        location: {
          file: uri.fsPath,
          line: parsed.line,
          preview: linePreview(source, parsed.line),
        },
        summary: kindSummary(parsed.kind, lang),
        syntax: parsed.kind === 'model'
          ? lang === 'tr'
            ? 'Eloquent model sınıfları çoğunlukla Illuminate\\Database\\Eloquent\\Model sınıfını genişletir.'
            : 'Eloquent model classes usually extend Illuminate\\Database\\Eloquent\\Model.'
          : lang === 'tr'
            ? 'Bu rol, dosya konumu, sınıf adı ve Laravel kalıplarından statik olarak belirlendi.'
            : 'This role was inferred statically from the file location, class name, and Laravel conventions.',
      });
    }

    const classNames = createClassNameIndex(classes.keys());
    const collisions = new Set(ambiguousClassNames(classNames));
    // Only short names that were actually referenced without a namespace are a problem; imports and
    // fully qualified references resolve fine even when two classes share a short name.
    const ambiguousReferences = new Set<string>();
    const resolveClass = (name: string): string => {
      if (!name.includes('\\') && collisions.has(name)) ambiguousReferences.add(name);
      return resolveClassName(classNames, name);
    };
    // PHP class names are case-insensitive, so ...\\api\\UserController and ...\\Api\\UserController match.
    const findClassNode = (qualified: string): ArchitectureNode | undefined =>
      [...nodes.values()].find((node) => node.qualifiedName?.toLowerCase() === qualified.toLowerCase());
    const ensureClassNode = (name: string, location: SourceLocation, preferred?: NodeKind): ArchitectureNode => {
      const qualified = resolveClass(name);
      const existing = findClassNode(qualified);
      if (existing) return existing;
      const kind = preferred ?? inferredKind(qualified);
      const created: ArchitectureNode = {
        id: nodeId(kind, qualified),
        label: qualified.split('\\').pop() ?? qualified,
        qualifiedName: qualified,
        kind,
        location,
        summary: kindSummary(kind, lang),
        syntax: lang === 'tr'
          ? 'Bu sınıfa referans bulundu ancak sınıf dosyası taranan dizinlerde çözülemedi.'
          : 'A reference was found, but the class file was not resolved inside the scanned directories.',
        external: true,
      };
      nodes.set(created.id, created);
      return created;
    };

    const edges = new Map<string, ArchitectureEdge>();
    const addEdge = (
      sourceNode: ArchitectureNode,
      targetNode: ArchitectureNode,
      kind: ArchitectureEdge['kind'],
      label: string,
      location: SourceLocation,
      detail: string,
      confidence: ArchitectureEdge['confidence'] = 'exact',
    ): void => {
      const id = `${kind}:${sourceNode.id}->${targetNode.id}:${location.file}:${location.line}`;
      edges.set(id, {
        id,
        source: sourceNode.id,
        target: targetNode.id,
        kind,
        label,
        location,
        explanation: edgeExplanation(kind, sourceNode.label, targetNode.label, detail, lang),
        confidence,
      });
    };

    for (const { parsed, source, file } of classes.values()) {
      const owner = findClassNode(parsed.qualifiedName);
      if (!owner) continue;

      for (const dependency of parsed.dependencies) {
        const location = { file, line: dependency.line, preview: linePreview(source, dependency.line) };
        const target = ensureClassNode(dependency.type, location);
        addEdge(owner, target, 'injects', 'injects', location, dependency.variable);
      }
      for (const dependency of parsed.methodDependencies) {
        // Request, Collection and other framework types appear everywhere; framework events stay useful.
        if (dependency.type.startsWith('Illuminate\\') && !/\\Events\\/.test(dependency.type)) continue;
        const location = { file, line: dependency.line, preview: linePreview(source, dependency.line) };
        const target = ensureClassNode(dependency.type, location);
        const isHandler = ['handle', '__invoke'].includes(dependency.method);
        if (target.kind === 'event' && isHandler && owner.kind !== 'controller') {
          addEdge(owner, target, 'listens', 'listens', location, dependency.method);
        } else if (target.kind === 'request') {
          addEdge(owner, target, 'validates', `${dependency.method}()`, location, `$${dependency.variable}`);
        } else if (target.kind === 'model' && owner.kind === 'controller') {
          addEdge(owner, target, 'resolves', `${dependency.method}($${dependency.variable})`, location, dependency.variable);
        } else {
          addEdge(owner, target, 'injects', `${dependency.method}()`, location, dependency.variable);
        }
      }
      for (const registration of parsed.listeners) {
        const location = { file, line: registration.line, preview: linePreview(source, registration.line) };
        const listener = ensureClassNode(registration.listener, location, 'listener');
        const event = ensureClassNode(registration.event, location, 'event');
        const alreadyLinked = [...edges.values()].some(
          (edge) => edge.kind === 'listens' && edge.source === listener.id && edge.target === event.id,
        );
        if (!alreadyLinked) addEdge(listener, event, 'listens', 'listens', location, 'registered');
      }
      for (const relation of parsed.relations) {
        if (relation.target === 'polymorphic model') continue;
        const location = { file, line: relation.line, preview: linePreview(source, relation.line) };
        const target = ensureClassNode(relation.target, location, 'model');
        addEdge(owner, target, 'relates', relation.type, location, relation.type);
      }
      for (const dispatch of parsed.dispatches) {
        const location = { file, line: dispatch.line, preview: linePreview(source, dispatch.line) };
        const target = ensureClassNode(dispatch.target, location, dispatch.type);
        const kind = dispatch.type === 'job' ? 'dispatches' : 'fires';
        addEdge(owner, target, kind, dispatch.type === 'job' ? 'dispatches' : 'fires', location, dispatch.type);
      }
      for (const binding of parsed.bindings) {
        const location = { file, line: binding.line, preview: linePreview(source, binding.line) };
        const abstractNode = ensureClassNode(binding.abstract, location);
        const concreteNode = ensureClassNode(binding.concrete, location);
        addEdge(abstractNode, concreteNode, 'binds', 'binds to', location, 'container binding');
      }
    }

    const unresolvedMiddleware = new Set<string>();
    const parsedRouteFiles: Array<{ file: string; source: string; routes: ReturnType<typeof parseRoutes> }> = [];
    const resolveMiddleware = (name: string, routeLocation: SourceLocation): ArchitectureNode => {
      const alias = name.split(':')[0] ?? name;
      const registered = name.includes('\\') ? { target: name } : middlewareAliases.get(alias);
      if (registered) {
        const appClass = findClassNode(resolveClass(registered.target));
        if (appClass) return appClass;
        const id = nodeId('middleware', registered.target);
        const existing = nodes.get(id);
        if (existing) return existing;
        const isFramework = registered.target.startsWith('Illuminate\\');
        const created: ArchitectureNode = {
          id,
          label: name.includes('\\') ? (registered.target.split('\\').pop() ?? name) : alias,
          qualifiedName: registered.target,
          kind: 'middleware',
          location: registered.location ?? routeLocation,
          external: true,
          summary: kindSummary('middleware', lang),
          syntax: isFramework
            ? lang === 'tr'
              ? `'${alias}' Laravel’in kendi middleware alias’ıdır ve ${registered.target} sınıfına çözümlenir.`
              : `'${alias}' is a built-in Laravel middleware alias that resolves to ${registered.target}.`
            : lang === 'tr'
              ? `'${alias}' alias’ı ${registered.target} sınıfına kayıtlıdır, ancak sınıf dosyası taranan dizinlerde bulunamadı.`
              : `'${alias}' is registered to ${registered.target}, but the class file was not found in the scanned directories.`,
        };
        nodes.set(id, created);
        return created;
      }

      const id = nodeId('middleware', alias);
      const existing = nodes.get(id);
      if (existing) return existing;
      const isGroup = middlewareGroups.has(alias);
      if (!isGroup) {
        warnings.push(`Middleware alias '${alias}' could not be resolved to a class statically.`);
        unresolvedMiddleware.add(alias);
      }
      const created: ArchitectureNode = {
        id,
        label: alias,
        kind: 'middleware',
        location: routeLocation,
        external: true,
        summary: kindSummary('middleware', lang),
        syntax: isGroup
          ? lang === 'tr'
            ? `'${alias}' tek bir sınıf değil, bir middleware grubudur. Laravel bu gruptaki middleware’leri sırayla çalıştırır (session, CSRF, cookie şifreleme vb.).`
            : `'${alias}' is a middleware group rather than a single class. Laravel runs every middleware in the group in order (session, CSRF, cookie encryption, and so on).`
          : lang === 'tr'
            ? `'${alias}' alias’ı statik olarak bir sınıfa çözümlenemedi. Bir paket tarafından ya da çalışma zamanında kaydedilmiş olabilir.`
            : `'${alias}' could not be resolved to a class statically. A package or runtime code may register it.`,
      };
      nodes.set(id, created);
      return created;
    };

    for (const routeFile of routeFiles) {
      const routes = parseRoutes(routeFile.source);
      parsedRouteFiles.push({ ...routeFile, routes });
      for (const route of routes) {
        const routeLabel = `${route.method} /${route.uri.replace(/^\//, '')}`;
        const routeLocation = {
          file: routeFile.file,
          line: route.line,
          preview: linePreview(routeFile.source, route.line),
        };
        const closureSyntax = route.controller
          ? lang === 'tr'
            ? `Bu route bir closure ile tanımlanmış; closure isteği ${route.controller.split('\\').pop()}@${route.action} metoduna devrediyor.`
            : `This route is defined with a closure that hands the request to ${route.controller.split('\\').pop()}@${route.action}.`
          : lang === 'tr'
            ? 'Bu route isteği doğrudan route dosyasındaki bir closure ile işliyor; ayrı bir controller yok.'
            : 'This route handles the request inline with a closure in the route file; there is no separate controller.';
        const routeNode: ArchitectureNode = {
          id: nodeId('route', `${routeFile.file}:${route.line}:${routeLabel}`),
          label: routeLabel,
          kind: 'route',
          location: routeLocation,
          summary: kindSummary('route', lang),
          syntax: route.closure
            ? closureSyntax
            : lang === 'tr'
              ? 'Route facade üzerindeki HTTP metodu, URI ile handler arasındaki eşleşmeyi kaydeder.'
              : 'The HTTP method on the Route facade registers a mapping between the URI and its handler.',
        };
        nodes.set(routeNode.id, routeNode);

        if (route.controller) {
          const controller = ensureClassNode(resolveClass(route.controller), routeLocation, 'controller');
          addEdge(routeNode, controller, 'handles', route.action ?? '__invoke', routeLocation, route.action ?? '__invoke');
        } else if (!route.closure) {
          warnings.push(`${routeLabel}: the handler is built dynamically and could not be linked to a controller.`);
        }

        for (const middlewareName of route.middleware) {
          const middleware = resolveMiddleware(middlewareName, routeLocation);
          addEdge(routeNode, middleware, 'middleware', middlewareName, routeLocation, middlewareName);
        }
      }
    }

    let projectName = path.basename(root.fsPath);
    try {
      const composer = JSON.parse(decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'composer.json')))) as {
        name?: string;
      };
      projectName = composer.name ?? projectName;
    } catch {
      warnings.push('composer.json could not be parsed; the folder name is used as the project name.');
    }

    if (ambiguousReferences.size) {
      const names = [...ambiguousReferences].sort();
      warnings.unshift(
        `${names.length} class name(s) were referenced without a namespace while several classes share that name, so they were left unlinked instead of guessed: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ', …' : ''}`,
      );
    }

    const findings = vscode.workspace.getConfiguration('larascura').get<boolean>('doctor', true)
      ? diagnose({
        classes,
        routeFiles: parsedRouteFiles,
        knownMiddleware: new Set([...middlewareAliases.keys(), ...middlewareGroups]),
        unresolvedMiddleware,
        viewNames: await viewNamesOf(root, token),
      })
      : [];
    if (findings.some((finding) => finding.route)) {
      const resourceFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, 'resources/**/*.{php,js,ts,jsx,tsx,vue}'),
        new vscode.RelativePattern(root, '**/node_modules/**'),
        5000,
        token,
      );
      const texts: Array<{ file: string; text: string }> = [];
      for (const uri of resourceFiles) texts.push({ file: uri.fsPath, text: decode(await vscode.workspace.fs.readFile(uri)) });
      for (const { source, file } of classes.values()) texts.push({ file, text: source });
      linkRouteFindings(findings, texts);
    }

    return {
      projectName,
      root: root.fsPath,
      sourceDirectories: directories,
      generatedAt: new Date().toISOString(),
      nodes: [...nodes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)),
      edges: [...edges.values()],
      warnings: [...new Set(warnings)].slice(0, 100),
      findings,
    };
  }
}
