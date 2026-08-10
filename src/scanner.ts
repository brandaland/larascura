import * as path from 'node:path';
import * as vscode from 'vscode';
import { kindSummary, parsePhpClass, parseRoutes } from './phpParser.js';
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

const inferredKind = (name: string): NodeKind => {
  if (/Controller$/.test(name)) return 'controller';
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
    calls: tr ? `${source}, ${target} sınıfını kullanır.` : `${source} uses ${target}.`,
    dispatches: tr
      ? `${source}, ${target} job’ını dispatch eder; iş queue yapılandırmasına göre yürütülür.`
      : `${source} dispatches the ${target} job; queue configuration controls its execution.`,
    fires: tr
      ? `${source}, ${target} event’ini yayınlar; kayıtlı listener’lar bağımsız olarak tepki verir.`
      : `${source} fires the ${target} event; registered listeners can react independently.`,
    listens: tr ? `${source}, ${target} event’ini dinler.` : `${source} listens for ${target}.`,
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

export class LaravelScanner {
  public async scan(root: vscode.Uri, token?: vscode.CancellationToken): Promise<ArchitectureGraph> {
    const lang = language();
    const includeRepositories = vscode.workspace
      .getConfiguration('larascura')
      .get<boolean>('includeRepositories', true);
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, '{app,routes}/**/*.php'),
      new vscode.RelativePattern(root, '{vendor,storage,bootstrap/cache,node_modules}/**'),
      10000,
      token,
    );
    const nodes = new Map<string, ArchitectureNode>();
    const classes = new Map<string, { parsed: ParsedClass; source: string; file: string }>();
    const aliases = new Map<string, string>();
    const routeFiles: Array<{ file: string; source: string }> = [];
    const warnings: string[] = [];

    for (const uri of files) {
      if (token?.isCancellationRequested) throw new vscode.CancellationError();
      const source = decode(await vscode.workspace.fs.readFile(uri));
      const relative = normalize(path.relative(root.fsPath, uri.fsPath));
      if (relative.startsWith('routes/')) routeFiles.push({ file: uri.fsPath, source });

      const parsed = parsePhpClass(relative, source);
      if (!parsed) continue;
      if (!includeRepositories && parsed.kind === 'repository') parsed.kind = 'service';

      classes.set(parsed.qualifiedName, { parsed, source, file: uri.fsPath });
      aliases.set(parsed.shortName, parsed.qualifiedName);
      aliases.set(parsed.qualifiedName, parsed.qualifiedName);
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

    const resolveClass = (name: string): string => aliases.get(name) ?? aliases.get(name.split('\\').pop() ?? name) ?? name;
    const findClassNode = (qualified: string): ArchitectureNode | undefined =>
      [...nodes.values()].find((node) => node.qualifiedName === qualified);
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
          ? 'Bu sınıfa referans bulundu ancak sınıf dosyası taranan app/ dizininde çözülemedi.'
          : 'A reference was found, but the class file was not resolved inside the scanned app/ directory.',
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

    for (const routeFile of routeFiles) {
      for (const route of parseRoutes(routeFile.source)) {
        const routeLabel = `${route.method} /${route.uri.replace(/^\//, '')}`;
        const routeLocation = {
          file: routeFile.file,
          line: route.line,
          preview: linePreview(routeFile.source, route.line),
        };
        const routeNode: ArchitectureNode = {
          id: nodeId('route', `${routeFile.file}:${route.line}:${routeLabel}`),
          label: routeLabel,
          kind: 'route',
          location: routeLocation,
          summary: kindSummary('route', lang),
          syntax: lang === 'tr'
            ? 'Route facade üzerindeki HTTP metodu, URI ile handler arasındaki eşleşmeyi kaydeder.'
            : 'The HTTP method on the Route facade registers a mapping between the URI and its handler.',
        };
        nodes.set(routeNode.id, routeNode);

        if (route.controller) {
          const controller = ensureClassNode(resolveClass(route.controller), routeLocation, 'controller');
          addEdge(routeNode, controller, 'handles', route.action ?? '__invoke', routeLocation, route.action ?? '__invoke');
        } else {
          warnings.push(`${routeLabel}: closure or dynamic handler could not be linked to a controller.`);
        }

        for (const middlewareName of route.middleware) {
          const middleware: ArchitectureNode = {
            id: nodeId('middleware', middlewareName),
            label: middlewareName,
            kind: 'middleware',
            location: routeLocation,
            summary: kindSummary('middleware', lang),
            syntax: lang === 'tr'
              ? 'Route middleware adı, Laravel middleware alias kayıtlarından gerçek sınıfa çözümlenir.'
              : 'Laravel resolves this route middleware alias to its registered middleware class.',
          };
          nodes.set(middleware.id, nodes.get(middleware.id) ?? middleware);
          addEdge(routeNode, nodes.get(middleware.id)!, 'middleware', 'passes through', routeLocation, middlewareName);
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

    return {
      projectName,
      root: root.fsPath,
      generatedAt: new Date().toISOString(),
      nodes: [...nodes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)),
      edges: [...edges.values()],
      warnings: [...new Set(warnings)].slice(0, 100),
    };
  }
}
