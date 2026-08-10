import type { NodeKind, ParsedClass, ParsedRoute } from './types.js';

const lineNumber = (source: string, index: number): number =>
  source.slice(0, Math.max(0, index)).split('\n').length;

const shortName = (name: string): string => name.split('\\').pop() ?? name;

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
  const cleaned = name.trim().replace(/^\\/, '');
  if (!cleaned || ['self', 'static', 'parent'].includes(cleaned)) return cleaned;
  if (cleaned.includes('\\')) return cleaned;
  return imports.get(cleaned) ?? (namespace ? `${namespace}\\${cleaned}` : cleaned);
};

const classify = (file: string, name: string, extendsName = ''): ParsedClass['kind'] => {
  const normalized = file.replaceAll('\\', '/');
  if (/Controller$/.test(name) || /\/Controllers\//.test(normalized)) return 'controller';
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

  const constructor = /function\s+__construct\s*\(([\s\S]*?)\)\s*\{/m.exec(source);
  if (constructor?.[1] && constructor.index !== undefined) {
    const parameterPattern = /(?:(?:public|protected|private|readonly)\s+)*([\\\w]+)\s+\$(\w+)/g;
    let parameter: RegExpExecArray | null;
    while ((parameter = parameterPattern.exec(constructor[1]))) {
      if (!parameter[1] || !parameter[2]) continue;
      dependencies.push({
        type: resolveName(parameter[1], imports, namespace),
        variable: parameter[2],
        line: lineNumber(source, constructor.index + parameter.index),
      });
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
      if (!dispatch[1] || ['event', 'self', 'static'].includes(dispatch[1])) continue;
      dispatches.push({
        type: 'job',
        target: resolveName(dispatch[1], imports, namespace),
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
    kind: classify(file, name, `${extendsName} ${implementsNames}`),
    line: lineNumber(source, classMatch.index),
    dependencies,
    relations,
    dispatches,
    bindings,
  };
};

const stringsFrom = (value: string): string[] =>
  [...value.matchAll(/['"]([^'"]+)['"]/g)].flatMap((match) => (match[1] ? [match[1]] : []));

export const parseRoutes = (source: string): ParsedRoute[] => {
  const imports = importsFrom(source);
  const namespace = namespaceFrom(source);
  const routes: ParsedRoute[] = [];
  const routePattern = /Route::(get|post|put|patch|delete|options|any|match)\s*\(\s*(['"])(.*?)\2\s*,\s*([\s\S]*?)\)\s*((?:->[^;]+)?)\s*;/g;
  let match: RegExpExecArray | null;

  while ((match = routePattern.exec(source))) {
    const method = (match[1] ?? 'any').toUpperCase();
    const uri = match[3] ?? '/';
    const handler = match[4] ?? '';
    const chain = match[5] ?? '';
    const arrayHandler = /\[\s*([\\\w]+)::class\s*,\s*['"]([^'"]+)['"]\s*\]/.exec(handler);
    const invokableHandler = /([\\\w]+)::class/.exec(handler);
    const legacyHandler = /['"]([\\\w]+)@([^'"]+)['"]/.exec(handler);
    const middlewareCall = /->middleware\s*\(([^)]*)\)/.exec(chain);
    let controller: string | undefined;
    let action: string | undefined;

    if (arrayHandler?.[1]) {
      controller = resolveName(arrayHandler[1], imports, namespace);
      action = arrayHandler[2];
    } else if (legacyHandler?.[1]) {
      controller = resolveName(legacyHandler[1], imports, namespace);
      action = legacyHandler[2];
    } else if (invokableHandler?.[1]) {
      controller = resolveName(invokableHandler[1], imports, namespace);
      action = '__invoke';
    }

    routes.push({
      method,
      uri,
      controller,
      action,
      middleware: middlewareCall?.[1] ? stringsFrom(middlewareCall[1]) : [],
      line: lineNumber(source, match.index),
    });
  }

  return routes;
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
