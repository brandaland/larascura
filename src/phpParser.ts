import type { NodeKind, ParsedClass, ParsedMiddlewareAlias, ParsedRoute, ViewReference } from './types.js';

const lineNumber = (source: string, index: number): number =>
  source.slice(0, Math.max(0, index)).split('\n').length;

const shortName = (name: string): string => name.split('\\').pop() ?? name;

const scalarTypes = new Set([
  'array',
  'bool',
  'callable',
  'false',
  'float',
  'int',
  'iterable',
  'mixed',
  'never',
  'null',
  'object',
  'string',
  'true',
  'void',
]);

// PHP's own classes are language plumbing (Closure $next, DateTime $at), not architecture.
const builtinClasses = new Set([
  'ArrayAccess',
  'ArrayIterator',
  'ArrayObject',
  'BackedEnum',
  'Closure',
  'Countable',
  'DateInterval',
  'DatePeriod',
  'DateTime',
  'DateTimeImmutable',
  'DateTimeInterface',
  'DateTimeZone',
  'Error',
  'Exception',
  'Generator',
  'Iterator',
  'IteratorAggregate',
  'JsonSerializable',
  'SplFileInfo',
  'Stringable',
  'Throwable',
  'Traversable',
  'UnitEnum',
  'WeakMap',
  'stdClass',
]);

const importsFrom = (source: string): Map<string, string> => {
  const imports = new Map<string, string>();
  const pattern = /^use\s+([^;]+);/gm;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source))) {
    const statement = match[1]?.trim();
    if (!statement || statement.startsWith('function ') || statement.startsWith('const ')) continue;

    const aliasParts = statement.split(/\s+as\s+/i);
    const qualified = aliasParts[0]?.trim();
    const alias = aliasParts[1]?.trim() ?? (qualified ? shortName(qualified) : undefined);
    if (qualified && alias) imports.set(alias, qualified);
  }

  return imports;
};

const namespaceFrom = (source: string): string =>
  source.match(/^namespace\s+([^;]+);/m)?.[1]?.trim() ?? '';

const resolveName = (name: string, imports: Map<string, string>, namespace: string): string => {
  const trimmed = name.trim();
  const cleaned = trimmed.replace(/^\\/, '');
  if (!cleaned || ['self', 'static', 'parent'].includes(cleaned)) return cleaned;
  // A leading backslash (\Closure) or any namespace separator means the name is already fully qualified.
  if (trimmed.startsWith('\\') || cleaned.includes('\\')) return cleaned;
  return imports.get(cleaned) ?? (namespace ? `${namespace}\\${cleaned}` : cleaned);
};

const classify = (file: string, name: string, extendsName = ''): ParsedClass['kind'] => {
  const normalized = file.replaceAll('\\', '/');
  if (/Controller$/.test(name) || /\/Controllers\//.test(normalized)) return 'controller';
  if (/\/Http\/Middleware\//.test(normalized)) return 'middleware';
  if (/FormRequest\b/.test(extendsName) || /\/Http\/Requests\//.test(normalized)) return 'request';
  if (/Repository$/.test(name) || /\/Repositories\//.test(normalized)) return 'repository';
  if (/Service$/.test(name) || /\/Services\//.test(normalized)) return 'service';
  if (/Job$/.test(name) || /\/Jobs\//.test(normalized) || /ShouldQueue/.test(extendsName)) return 'job';
  if (/Event$/.test(name) || /\/Events\//.test(normalized)) return 'event';
  if (/Listener$/.test(name) || /\/Listeners\//.test(normalized)) return 'listener';
  if (/Provider$/.test(name) || /\/Providers\//.test(normalized)) return 'provider';
  if (/Command$/.test(name) || /\/Console\/Commands\//.test(normalized)) return 'command';
  if (/Model$/.test(extendsName) || /\/Models\//.test(normalized)) return 'model';
  return 'class';
};

// Returns the index just after the bracket that closes the one at `open`, skipping strings.
const balancedEnd = (source: string, open: number): number | undefined => {
  let depth = 0;
  let quote = '';
  for (let index = open; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return undefined;
};

const topLevelParts = (value: string): Array<{ text: string; offset: number }> => {
  const parts: Array<{ text: string; offset: number }> = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push({ text: value.slice(start, index), offset: start });
      start = index + 1;
    }
  }
  parts.push({ text: value.slice(start), offset: start });
  return parts;
};

interface ParsedMethod {
  name: string;
  index: number;
  visibility: 'public' | 'protected' | 'private';
  isStatic: boolean;
  hasBody: boolean;
  parameters: Array<{ types: string[]; variable: string; index: number }>;
}

const methodsFrom = (source: string): ParsedMethod[] => {
  const methods: ParsedMethod[] = [];
  const pattern = /((?:(?:public|protected|private|static|final|abstract)\s+)*)function\s+&?\s*(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const open = match.index + match[0].length - 1;
    const end = balancedEnd(source, open);
    if (end === undefined || !match[2]) continue;
    const modifiers = match[1] ?? '';
    const terminator = /^\s*(?::\s*[^{;]+)?\s*([{;])/.exec(source.slice(end));
    const parameterList = source.slice(open + 1, end - 1);
    const parameters: ParsedMethod['parameters'] = [];
    for (const part of topLevelParts(parameterList)) {
      const withoutAttributes = part.text.replace(/#\[[^\]]*\]/g, (attribute) => ' '.repeat(attribute.length));
      const parameter = /^(\s*)(?:(?:public|protected|private|readonly)\s+)*([?\\\w|&()]+)\s+&?\s*(?:\.\.\.)?\$(\w+)/.exec(withoutAttributes);
      if (!parameter?.[2] || !parameter[3]) continue;
      const types = parameter[2]
        .split(/[|&]/)
        .map((type) => type.replace(/[?()]/g, ''))
        .filter((type) => type && !scalarTypes.has(type.toLowerCase()) && !['self', 'static', 'parent'].includes(type));
      parameters.push({
        types,
        variable: parameter[3],
        index: open + 1 + part.offset + (parameter[1]?.length ?? 0),
      });
    }
    methods.push({
      name: match[2],
      index: match.index,
      visibility: /private/.test(modifiers) ? 'private' : /protected/.test(modifiers) ? 'protected' : 'public',
      isStatic: /static/.test(modifiers),
      hasBody: terminator?.[1] === '{',
      parameters,
    });
  }
  return methods;
};

// The container resolves type-hinted parameters on controller actions and on handle()/__invoke().
const containerResolvedMethod = (method: ParsedMethod, kind: ParsedClass['kind']): boolean => {
  if (!method.hasBody || method.isStatic || method.visibility !== 'public' || method.name === '__construct') return false;
  if (['handle', '__invoke'].includes(method.name)) return true;
  return kind === 'controller' && !method.name.startsWith('__');
};

const arrayBodyAfter = (source: string, pattern: RegExp): Array<{ body: string; index: number }> => {
  const bodies: Array<{ body: string; index: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const open = match.index + match[0].length - 1;
    const end = balancedEnd(source, open);
    if (end !== undefined) bodies.push({ body: source.slice(open + 1, end - 1), index: open + 1 });
  }
  return bodies;
};

const listenersFrom = (
  source: string,
  imports: Map<string, string>,
  namespace: string,
): ParsedClass['listeners'] => {
  const listeners: ParsedClass['listeners'] = [];
  for (const { body, index } of arrayBodyAfter(source, /\$listen\s*=\s*\[/g)) {
    for (const entry of body.matchAll(/([\\\w]+)::class\s*=>\s*\[([^\]]*)\]/g)) {
      if (!entry[1] || entry.index === undefined) continue;
      for (const listener of (entry[2] ?? '').matchAll(/([\\\w]+)::class/g)) {
        if (!listener[1] || listener.index === undefined) continue;
        listeners.push({
          event: resolveName(entry[1], imports, namespace),
          listener: resolveName(listener[1], imports, namespace),
          line: lineNumber(source, index + entry.index + entry[0].indexOf('[') + 1 + listener.index),
        });
      }
    }
  }
  for (const call of source.matchAll(/Event::listen\s*\(\s*([\\\w]+)::class\s*,\s*\[?\s*([\\\w]+)::class/g)) {
    if (!call[1] || !call[2] || call.index === undefined) continue;
    listeners.push({
      event: resolveName(call[1], imports, namespace),
      listener: resolveName(call[2], imports, namespace),
      line: lineNumber(source, call.index),
    });
  }
  return listeners;
};

export const parseMiddlewareAliases = (source: string): ParsedMiddlewareAlias[] => {
  const imports = importsFrom(source);
  const namespace = namespaceFrom(source);
  const aliases: ParsedMiddlewareAlias[] = [];
  const bodies = arrayBodyAfter(source, /(?:\$middlewareAliases|\$routeMiddleware)\s*=\s*\[|->alias\s*\(\s*\[/g);
  for (const { body, index } of bodies) {
    for (const entry of body.matchAll(/['"]([\w.\-]+)['"]\s*=>\s*(?:([\\\w]+)::class|['"]\\?([\\\w]+)['"])/g)) {
      const target = entry[2] ?? entry[3];
      if (!entry[1] || !target || entry.index === undefined) continue;
      aliases.push({
        alias: entry[1],
        target: entry[3] ? target.replace(/\\\\/g, '\\') : resolveName(target, imports, namespace),
        line: lineNumber(source, index + entry.index),
      });
    }
  }
  return aliases;
};

// Traits are `use` statements inside the class body; imports above the class are not.
const traitsFrom = (source: string, bodyStart: number, imports: Map<string, string>, namespace: string): string[] => {
  const body = source.slice(bodyStart);
  const traits: string[] = [];
  for (const statement of body.matchAll(/^\s*use\s+([\\\w\s,]+?)\s*[;{]/gm)) {
    for (const name of (statement[1] ?? '').split(',')) {
      if (name.trim()) traits.push(resolveName(name.trim(), imports, namespace));
    }
  }
  return traits;
};

/** Literal view names passed to view(), View::make(), Route::view(), ->view() and ->markdown(). */
export const viewReferences = (source: string): ViewReference[] => {
  const references: ViewReference[] = [];
  const patterns = [
    // The trailing (?!\s*\.) skips names built by concatenation, such as view('emails.' . $type).
    /\bview\s*\(\s*(['"])([^'"$]+)\1(?!\s*\.)/g,
    /View::make\s*\(\s*(['"])([^'"$]+)\1(?!\s*\.)/g,
    /Route::view\s*\(\s*['"][^'"]*['"]\s*,\s*(['"])([^'"$]+)\1(?!\s*\.)/g,
    /->(?:view|markdown)\s*\(\s*(['"])([^'"$]+)\1(?!\s*\.)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const name = match[2]?.trim();
      // Package views (pkg::name) live outside resources/views.
      if (!name || name.includes('::') || name.endsWith('.') || match.index === undefined) continue;
      references.push({ name: name.replaceAll('/', '.'), line: lineNumber(source, match.index) });
    }
  }
  return references.sort((left, right) => left.line - right.line);
};

export const parsePhpClass = (file: string, source: string): ParsedClass | undefined => {
  const namespace = namespaceFrom(source);
  const imports = importsFrom(source);
  const classMatch = /(?:final\s+|abstract\s+|readonly\s+)*class\s+(\w+)(?:\s+extends\s+([\\\w]+))?(?:\s+implements\s+([^\{]+))?/m.exec(source);
  if (!classMatch?.[1]) return undefined;

  const name = classMatch[1];
  const extendsName = classMatch[2] ?? '';
  const implementsNames = classMatch[3] ?? '';
  const qualifiedName = namespace ? `${namespace}\\${name}` : name;
  const dependencies: ParsedClass['dependencies'] = [];
  const relations: ParsedClass['relations'] = [];
  const dispatches: ParsedClass['dispatches'] = [];
  const bindings: ParsedClass['bindings'] = [];

  const kind = classify(file, name, `${extendsName} ${implementsNames}`);
  const methodDependencies: ParsedClass['methodDependencies'] = [];
  const methods = methodsFrom(source);
  for (const method of methods) {
    const isConstructor = method.name === '__construct' && method.hasBody;
    if (!isConstructor && !containerResolvedMethod(method, kind)) continue;
    for (const parameter of method.parameters) {
      for (const type of parameter.types) {
        const resolved = resolveName(type, imports, namespace);
        if (builtinClasses.has(resolved)) continue;
        const dependency = {
          type: resolved,
          variable: parameter.variable,
          line: lineNumber(source, parameter.index),
        };
        if (isConstructor) dependencies.push(dependency);
        else methodDependencies.push({ method: method.name, ...dependency });
      }
    }
  }

  const relationPattern = /\$this->(hasOne|hasMany|belongsTo|belongsToMany|morphOne|morphMany|morphToMany)\s*\(\s*([\\\w]+)::class/g;
  let relation: RegExpExecArray | null;
  while ((relation = relationPattern.exec(source))) {
    if (!relation[1] || !relation[2]) continue;
    relations.push({
      type: relation[1],
      target: resolveName(relation[2], imports, namespace),
      line: lineNumber(source, relation.index),
    });
  }

  const morphToPattern = /\$this->morphTo\s*\(/g;
  while ((relation = morphToPattern.exec(source))) {
    relations.push({ type: 'morphTo', target: 'polymorphic model', line: lineNumber(source, relation.index) });
  }

  const jobPatterns = [
    /([\\\w]+)::dispatch(?:Sync|AfterResponse)?\s*\(/g,
    /dispatch(?:_sync)?\s*\(\s*new\s+([\\\w]+)/g,
  ];
  for (const pattern of jobPatterns) {
    let dispatch: RegExpExecArray | null;
    while ((dispatch = pattern.exec(source))) {
      if (!dispatch[1] || ['Bus', 'Event', 'Queue', 'event', 'self', 'static'].includes(dispatch[1])) continue;
      const target = resolveName(dispatch[1], imports, namespace);
      dispatches.push({
        type: /(?:^|\\)Events\\|Event$/.test(target) ? 'event' : 'job',
        target,
        line: lineNumber(source, dispatch.index),
      });
    }
  }

  const eventPatterns = [
    /event\s*\(\s*new\s+([\\\w]+)/g,
    /Event::dispatch\s*\(\s*new\s+([\\\w]+)/g,
  ];
  for (const pattern of eventPatterns) {
    let event: RegExpExecArray | null;
    while ((event = pattern.exec(source))) {
      if (!event[1]) continue;
      dispatches.push({
        type: 'event',
        target: resolveName(event[1], imports, namespace),
        line: lineNumber(source, event.index),
      });
    }
  }

  const bindingPattern = /(?:app\(\)|\$this->app)->(bind|singleton|scoped)\s*\(\s*([\\\w]+)::class\s*,\s*([\\\w]+)::class/g;
  let binding: RegExpExecArray | null;
  while ((binding = bindingPattern.exec(source))) {
    if (!binding[2] || !binding[3]) continue;
    bindings.push({
      abstract: resolveName(binding[2], imports, namespace),
      concrete: resolveName(binding[3], imports, namespace),
      line: lineNumber(source, binding.index),
    });
  }

  return {
    qualifiedName,
    shortName: name,
    kind,
    line: lineNumber(source, classMatch.index),
    dependencies,
    methodDependencies,
    listeners: listenersFrom(source, imports, namespace),
    methods: methods
      .filter((method) => method.visibility === 'public' && method.hasBody)
      .map((method) => ({ name: method.name, line: lineNumber(source, method.index) })),
    parent: extendsName ? resolveName(extendsName, imports, namespace) : undefined,
    traits: traitsFrom(source, classMatch.index + classMatch[0].length, imports, namespace),
    namespaceLine: (() => {
      const declaration = /^namespace\s+[^;]+;/m.exec(source);
      return declaration ? lineNumber(source, declaration.index) : undefined;
    })(),
    hasMagicCall: methods.some((method) => method.name.toLowerCase() === '__call'),
    viewReferences: viewReferences(source),
    relations,
    dispatches,
    bindings,
  };
};

const stringsFrom = (value: string): string[] =>
  [...value.matchAll(/['"]([^'"]+)['"]/g)].flatMap((match) => (match[1] ? [match[1]] : []));

type NameResolver = (name: string) => string;

// Middleware may be named by alias ('auth:sanctum') or by class (EnsureAdmin::class).
const middlewareFrom = (value: string, resolve: NameResolver): string[] =>
  [...value.matchAll(/['"]([^'"]+)['"]|([\\\w]+)::class/g)].flatMap((match) => {
    if (match[1]) return match[1].startsWith(':') ? [] : [match[1]];
    return match[2] ? [resolve(match[2])] : [];
  });

interface RouteGroup {
  start: number;
  end: number;
  prefix?: string;
  middleware: string[];
}

const closingBrace = (source: string, openingBrace: number): number | undefined => {
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';

    if (lineComment) {
      if (character === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '#') {
      lineComment = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
};

const routeGroupsFrom = (source: string, resolve: NameResolver): RouteGroup[] => {
  const groups: RouteGroup[] = [];
  const addGroup = (match: RegExpExecArray, settings: string): void => {
    const openingBrace = match.index + match[0].lastIndexOf('{');
    const end = closingBrace(source, openingBrace);
    if (end === undefined) return;
    const prefix = /(?:prefix\s*\(\s*(['"])(.*?)\1|['"]prefix['"]\s*=>\s*(['"])(.*?)\3)/.exec(settings);
    const middleware: string[] = [];
    for (const middlewareCall of settings.matchAll(/middleware\s*\(([^)]*)\)/g)) {
      if (middlewareCall[1]) middleware.push(...middlewareFrom(middlewareCall[1], resolve));
    }
    const arrayMiddleware = /['"]middleware['"]\s*=>\s*(\[[^\]]*\]|['"][^'"]+['"])/.exec(settings);
    if (arrayMiddleware?.[1]) middleware.push(...middlewareFrom(arrayMiddleware[1], resolve));
    groups.push({
      start: openingBrace,
      end,
      prefix: prefix?.[2] ?? prefix?.[4],
      middleware: [...new Set(middleware)],
    });
  };

  const fluentPattern = /Route::([^;{}]*?)group\s*\(\s*function\s*\([^)]*\)\s*(?:use\s*\([^)]*\)\s*)?\{/g;
  let match: RegExpExecArray | null;
  while ((match = fluentPattern.exec(source))) addGroup(match, match[1] ?? '');

  const arrayPattern = /Route::group\s*\(\s*\[([\s\S]*?)\]\s*,\s*function\s*\([^)]*\)\s*(?:use\s*\([^)]*\)\s*)?\{/g;
  while ((match = arrayPattern.exec(source))) addGroup(match, match[1] ?? '');
  return groups;
};

const joinedUri = (...parts: string[]): string => {
  const segments = parts.flatMap((part) => part.split('/')).filter(Boolean);
  return segments.length ? `/${segments.join('/')}` : '/';
};

const routeContext = (
  groups: RouteGroup[],
  index: number,
  uri: string,
  middleware: string[],
): { uri: string; middleware: string[] } => {
  const parents = groups.filter((group) => index > group.start && index < group.end).sort((a, b) => a.start - b.start);
  return {
    uri: joinedUri(...parents.flatMap((group) => (group.prefix ? [group.prefix] : [])), uri),
    middleware: [...new Set([...parents.flatMap((group) => group.middleware), ...middleware])],
  };
};

const parsedHandler = (
  handler: string,
  imports: Map<string, string>,
  namespace: string,
): Pick<ParsedRoute, 'controller' | 'action'> => {
  const arrayHandler = /\[\s*([\\\w]+)::class\s*,\s*['"]([^'"]+)['"]\s*\]/.exec(handler);
  const invokableHandler = /([\\\w]+)::class/.exec(handler);
  const legacyHandler = /['"]([\\\w]+)@([^'"]+)['"]/.exec(handler);
  if (arrayHandler?.[1]) {
    return { controller: resolveName(arrayHandler[1], imports, namespace), action: arrayHandler[2] };
  }
  if (legacyHandler?.[1]) {
    return { controller: resolveName(legacyHandler[1], imports, namespace), action: legacyHandler[2] };
  }
  if (invokableHandler?.[1]) {
    return { controller: resolveName(invokableHandler[1], imports, namespace), action: '__invoke' };
  }
  return {};
};

const singularResource = (name: string): string => {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1);
  return name;
};

const resourceUri = (name: string): { base: string; parameter: string } => {
  const resources = name.split('.').filter(Boolean);
  const parts: string[] = [];
  resources.forEach((resource, index) => {
    parts.push(resource);
    if (index < resources.length - 1) parts.push(`{${singularResource(resource)}}`);
  });
  const parameter = singularResource(resources.at(-1) ?? 'resource');
  return { base: joinedUri(...parts), parameter };
};

export const parseRoutes = (source: string): ParsedRoute[] => {
  const imports = importsFrom(source);
  const namespace = namespaceFrom(source);
  const routes: ParsedRoute[] = [];
  const resolve: NameResolver = (name) => resolveName(name, imports, namespace);
  const groups = routeGroupsFrom(source, resolve);
  const addRoute = (method: string, uri: string, handler: string, chain: string, index: number): void => {
    const middlewareCall = /->middleware\s*\(([^)]*)\)/.exec(chain);
    const context = routeContext(groups, index, uri, middlewareCall?.[1] ? middlewareFrom(middlewareCall[1], resolve) : []);
    routes.push({
      method,
      uri: context.uri,
      ...parsedHandler(handler, imports, namespace),
      middleware: context.middleware,
      line: lineNumber(source, index),
    });
  };

  const routePattern = /Route::(get|post|put|patch|delete|options|any)\s*\(\s*(['"])(.*?)\2\s*,\s*([\s\S]*?)\)\s*((?:->[^;]+)?)\s*;/g;
  let match: RegExpExecArray | null;

  while ((match = routePattern.exec(source))) {
    addRoute((match[1] ?? 'any').toUpperCase(), match[3] ?? '/', match[4] ?? '', match[5] ?? '', match.index);
  }

  const matchPattern = /Route::match\s*\(\s*(\[[^\]]*\])\s*,\s*(['"])(.*?)\2\s*,\s*([\s\S]*?)\)\s*((?:->[^;]+)?)\s*;/g;
  while ((match = matchPattern.exec(source))) {
    const methods = stringsFrom(match[1] ?? '').map((method) => method.toUpperCase()).join('|') || 'MATCH';
    addRoute(methods, match[3] ?? '/', match[4] ?? '', match[5] ?? '', match.index);
  }

  const resourcePattern = /Route::(apiResource|resource)\s*\(\s*(['"])(.*?)\2\s*,\s*([\\\w]+)::class\s*\)\s*((?:->[^;]+)?)\s*;/g;
  while ((match = resourcePattern.exec(source))) {
    const controller = resolveName(match[4] ?? '', imports, namespace);
    const chain = match[5] ?? '';
    const only = /->only\s*\(([^)]*)\)/.exec(chain)?.[1];
    const except = /->except\s*\(([^)]*)\)/.exec(chain)?.[1];
    const allowed = only ? new Set(stringsFrom(only)) : undefined;
    const excluded = new Set(except ? stringsFrom(except) : []);
    const { base, parameter } = resourceUri(match[3] ?? 'resource');
    const definitions = [
      ['index', 'GET', base],
      ['create', 'GET', joinedUri(base, 'create')],
      ['store', 'POST', base],
      ['show', 'GET', joinedUri(base, `{${parameter}}`)],
      ['edit', 'GET', joinedUri(base, `{${parameter}}`, 'edit')],
      ['update', 'PUT|PATCH', joinedUri(base, `{${parameter}}`)],
      ['destroy', 'DELETE', joinedUri(base, `{${parameter}}`)],
    ] as const;
    for (const [action, method, uri] of definitions) {
      if (match[1] === 'apiResource' && ['create', 'edit'].includes(action)) continue;
      if (allowed && !allowed.has(action)) continue;
      if (excluded.has(action)) continue;
      const middlewareCall = /->middleware\s*\(([^)]*)\)/.exec(chain);
      const context = routeContext(groups, match.index, uri, middlewareCall?.[1] ? middlewareFrom(middlewareCall[1], resolve) : []);
      routes.push({
        method,
        uri: context.uri,
        controller,
        action,
        middleware: context.middleware,
        line: lineNumber(source, match.index),
        fromResource: true,
      });
    }
  }

  return routes.sort((left, right) => left.line - right.line);
};

export const explainSyntax = (code: string, language: 'en' | 'tr'): string => {
  const normalized = code.trim();
  const tr = language === 'tr';

  if (/Route::(get|post|put|patch|delete)/.test(normalized)) {
    return tr
      ? 'Bu ifade bir HTTP adresini onu işleyecek controller veya closure ile eşleştirir.'
      : 'This expression maps an HTTP endpoint to the controller or closure that handles it.';
  }
  if (/->middleware\s*\(/.test(normalized)) {
    return tr
      ? 'Middleware, istek controller’a ulaşmadan önce çalışan bir kontrol katmanıdır.'
      : 'Middleware is a control layer that runs before the request reaches the controller.';
  }
  if (/function\s+__construct/.test(normalized) || /(?:private|protected|public)\s+[\\\w]+\s+\$/.test(normalized)) {
    return tr
      ? 'Laravel service container bu type-hint üzerinden bağımlılığı otomatik olarak oluşturup sınıfa verir.'
      : 'Laravel’s service container uses this type hint to construct and inject the dependency.';
  }
  if (/\$this->(?:hasMany|hasOne|belongsTo|belongsToMany|morph)/.test(normalized)) {
    return tr
      ? 'Bu metot iki Eloquent model arasındaki ilişkiyi tanımlar; Laravel sorgu ve foreign key davranışını bu tanımdan üretir.'
      : 'This method defines an Eloquent relationship; Laravel derives query and foreign-key behavior from it.';
  }
  if (/::dispatch|dispatch\s*\(/.test(normalized)) {
    return tr
      ? 'Bu ifade bir job’ı kuyruğa gönderir. Queue ayarına göre arka planda veya senkron çalışabilir.'
      : 'This dispatches a job. Depending on queue configuration, it can run in the background or synchronously.';
  }
  if (/event\s*\(|Event::dispatch/.test(normalized)) {
    return tr
      ? 'Bu ifade bir domain/application event’i yayınlar; kayıtlı listener’lar olaya tepki verir.'
      : 'This publishes a domain/application event; registered listeners react to it.';
  }

  return tr
    ? 'LaraScura bu PHP ifadesi için henüz Laravel’e özel kesin bir kalıp bulamadı.'
    : 'LaraScura did not find a precise Laravel-specific pattern for this PHP expression yet.';
};

export const kindSummary = (kind: NodeKind, language: 'en' | 'tr'): string => {
  const summaries: Record<NodeKind, [string, string]> = {
    route: ['HTTP isteğinin uygulamaya giriş noktasıdır.', 'The HTTP entry point into the application.'],
    middleware: ['İsteği controller’dan önce denetleyen katmandır.', 'A layer that checks or transforms a request before the controller.'],
    request: ['İsteği controller metodu çalışmadan önce doğrulayan ve yetkilendiren Form Request sınıfıdır.', 'A Form Request that validates and authorizes input before the controller action runs.'],
    controller: ['HTTP isteğini karşılar ve uygulama akışını koordine eder.', 'Receives HTTP requests and coordinates application flow.'],
    service: ['Tekrar kullanılabilir iş kurallarını taşır.', 'Contains reusable application or business logic.'],
    repository: ['Veriye erişimi soyutlayan katmandır.', 'Abstracts persistence and data access.'],
    model: ['Veritabanı kaydını ve Eloquent ilişkilerini temsil eder.', 'Represents a database record and its Eloquent relationships.'],
    job: ['Kuyrukta veya senkron çalıştırılabilen işi temsil eder.', 'Represents work that can run on a queue or synchronously.'],
    event: ['Uygulamada gerçekleşen bir olayı bildirir.', 'Announces something that happened in the application.'],
    listener: ['Bir event’e tepki veren sınıftır.', 'A class that reacts to an event.'],
    provider: ['Container binding ve uygulama başlangıç ayarlarını kaydeder.', 'Registers container bindings and application bootstrapping.'],
    command: ['Artisan üzerinden çalıştırılan komuttur.', 'A command executed through Artisan.'],
    class: ['Henüz özel Laravel rolü belirlenmemiş PHP sınıfıdır.', 'A PHP class without a more specific Laravel role.'],
  };
  return summaries[kind][language === 'tr' ? 0 : 1];
};
