import { viewReferences } from './phpParser.js';
import type { Finding, ParsedClass, ParsedRoute } from './types.js';

export type { Finding };

export interface DoctorInput {
  classes: Map<string, { parsed: ParsedClass; file: string }>;
  routeFiles: Array<{ file: string; source: string; routes: ParsedRoute[] }>;
  /** Every middleware alias and group name known statically. */
  knownMiddleware: Set<string>;
  /** Aliases used by routes that resolved to nothing. */
  unresolvedMiddleware: Set<string>;
  /** View names under resources/views, or undefined when views cannot be checked reliably. */
  viewNames?: Set<string>;
}

// Parents and traits whose methods are known not to provide route actions.
const knownParents = new Set(['Illuminate\\Routing\\Controller']);
const knownTraits = new Set([
  'Illuminate\\Foundation\\Auth\\Access\\AuthorizesRequests',
  'Illuminate\\Foundation\\Bus\\DispatchesJobs',
  'Illuminate\\Foundation\\Validation\\ValidatesRequests',
]);

const shortName = (name: string): string => name.split('\\').pop() ?? name;
const namespaceOf = (name: string): string => name.split('\\').slice(0, -1).join('\\');

/** Optimal string alignment distance: Levenshtein plus adjacent transpositions (atuh → auth is 1). */
export const editDistance = (left: string, right: string): number => {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1);
      }
    }
  }
  return rows[a.length]![b.length]!;
};

/** The single closest candidate within a typo-sized distance, or undefined when none or several tie. */
export const closest = (value: string, candidates: Iterable<string>): string | undefined => {
  const limit = value.length <= 4 ? 1 : value.length <= 8 ? 2 : 3;
  let best: string | undefined;
  let bestDistance = Infinity;
  let tie = false;
  for (const candidate of new Set(candidates)) {
    if (candidate === value) continue;
    const distance = editDistance(value, candidate);
    if (distance > limit || distance > bestDistance) continue;
    tie = distance === bestDistance;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return tie ? undefined : best;
};

const didYouMean = (suggestion: string | undefined): string => (suggestion ? ` Did you mean "${suggestion}"?` : '');

export const diagnose = (input: DoctorInput): Finding[] => {
  const findings: Finding[] = [];
  // PHP class names are case-insensitive: App\Http\Controllers\api\X and ...\Api\X are the same class.
  const byLowerName = new Map([...input.classes.entries()].map(([name, entry]) => [name.toLowerCase(), entry]));
  const classOf = (name: string) => byLowerName.get(name.toLowerCase());
  const projectRoots = new Set([...input.classes.keys()].map((name) => name.split('\\')[0]!.toLowerCase()));
  const isProjectClass = (name: string): boolean => projectRoots.has(name.split('\\')[0]!.toLowerCase());
  const classesOfKind = (kind: ParsedClass['kind']): string[] =>
    [...input.classes.values()].filter(({ parsed }) => parsed.kind === kind).map(({ parsed }) => parsed.shortName);

  // Methods a class can answer with, and whether that list is complete.
  const actionsOf = (name: string, seen = new Set<string>()): { names: Set<string>; certain: boolean } => {
    const entry = classOf(name);
    if (!entry || seen.has(name.toLowerCase())) return { names: new Set(), certain: knownParents.has(name) };
    seen.add(name.toLowerCase());
    const { parsed } = entry;
    const names = new Set(parsed.methods.map((method) => method.name.toLowerCase()));
    let certain = !parsed.hasMagicCall && parsed.traits.every((trait) => knownTraits.has(trait));
    if (parsed.parent) {
      const inherited = actionsOf(parsed.parent, seen);
      inherited.names.forEach((method) => names.add(method));
      certain &&= inherited.certain;
    }
    return { names, certain };
  };

  for (const { file, source, routes } of input.routeFiles) {
    const missingResourceActions = new Map<string, { line: number; controller: string; actions: string[] }>();

    for (const route of routes) {
      if (!route.controller) continue;
      const controller = classOf(route.controller);
      if (!controller) {
        if (isProjectClass(route.controller) && !route.fromResource) {
          findings.push({
            file,
            line: route.line,
            severity: 'warning',
            code: 'missing-controller',
            message: `Controller ${route.controller} was not found.${didYouMean(closest(shortName(route.controller), classesOfKind('controller')))}`,
            token: shortName(route.controller),
          });
        }
        continue;
      }

      const action = route.action ?? '__invoke';
      const { names, certain } = actionsOf(controller.parsed.qualifiedName);
      if (!certain || names.has(action.toLowerCase())) continue;

      if (route.fromResource) {
        const key = `${route.line}|${route.controller}`;
        const entry = missingResourceActions.get(key) ?? { line: route.line, controller: controller.parsed.shortName, actions: [] };
        entry.actions.push(action);
        missingResourceActions.set(key, entry);
      } else if (action === '__invoke') {
        findings.push({
          file,
          line: route.line,
          severity: 'warning',
          code: 'missing-invoke',
          message: `${controller.parsed.shortName} is used as a single-action controller but has no __invoke() method, so this route fails when it is called.`,
          token: controller.parsed.shortName,
        });
      } else {
        const declared = controller.parsed.methods.map((method) => method.name).filter((method) => !method.startsWith('__'));
        const suggestion = closest(action, declared);
        findings.push({
          file,
          line: route.line,
          severity: 'warning',
          code: 'missing-action',
          message: `${controller.parsed.shortName} has no method "${action}()", so this route fails with "Method does not exist".${didYouMean(suggestion)}`,
          token: action,
          replacement: suggestion,
        });
      }
    }

    for (const { line, controller, actions } of missingResourceActions.values()) {
      findings.push({
        file,
        line,
        severity: 'information',
        code: 'resource-actions',
        message: `This resource registers ${actions.join(', ')}, but ${controller} has no such method${actions.length === 1 ? '' : 's'}. Add ->except(['${actions.join("', '")}']) so these URLs do not fail.`,
      });
    }

    // Laravel keeps only the last route registered for the same method and URI.
    if (!/domain\s*\(/.test(source)) {
      const seen = new Map<string, ParsedRoute>();
      for (const route of routes) {
        for (const method of route.method.split('|')) {
          const key = `${method} ${route.uri}`;
          const earlier = seen.get(key);
          if (earlier && earlier.line !== route.line) {
            findings.push({
              file,
              line: route.line,
              severity: earlier.fromResource || route.fromResource ? 'information' : 'warning',
              code: 'duplicate-route',
              message: `${key} is already defined on line ${earlier.line}. Laravel keeps only the last definition, so the route on line ${earlier.line} never runs.`,
            });
          }
          seen.set(key, route);
        }
      }
    }

    // A misspelled middleware alias only fails at request time; flag it where it is written.
    for (const alias of input.unresolvedMiddleware) {
      const suggestion = closest(alias, input.knownMiddleware);
      if (!suggestion) continue;
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const usage = new RegExp(`(['"])${escaped}(?::[^'"]*)?\\1`);
      source.split(/\r?\n/).forEach((text, index) => {
        if (!usage.test(text)) return;
        findings.push({
          file,
          line: index + 1,
          severity: 'warning',
          code: 'unknown-middleware',
          message: `Middleware "${alias}" is not registered, so requests fail with "Target class [${alias}] does not exist".${didYouMean(suggestion)}`,
          token: alias,
          replacement: suggestion,
        });
      });
    }
  }

  const models = classesOfKind('model');
  for (const { parsed, file } of input.classes.values()) {
    for (const relation of parsed.relations) {
      if (relation.target === 'polymorphic model' || classOf(relation.target) || !isProjectClass(relation.target)) continue;
      const suggestion = closest(shortName(relation.target), models);
      findings.push({
        file,
        line: relation.line,
        severity: 'warning',
        code: 'missing-model',
        message: `${parsed.shortName}::${relation.type}() points at ${relation.target}, which does not exist.${didYouMean(suggestion)}`,
        token: shortName(relation.target),
        // Only safe to rewrite when no import is involved, i.e. both models share a namespace.
        replacement: suggestion && namespaceOf(relation.target) === namespaceOf(parsed.qualifiedName) ? suggestion : undefined,
      });
    }
  }

  // PSR-4 maps namespace segments to folders with the same letter case.
  for (const { parsed, file } of input.classes.values()) {
    const [rootSegment, ...namespaceParts] = parsed.qualifiedName.split('\\');
    const segments = namespaceParts.slice(0, -1);
    const allFolders = file.split(/[\\/]/).slice(0, -1);
    const folders = allFolders.slice(-segments.length);
    // Only judge classes whose root namespace sits in its PSR-4 folder (App → app/); copied
    // libraries such as app/Lib/vendor-sdk/tests follow their own autoload rules.
    const rootFolder = allFolders[allFolders.length - segments.length - 1];
    if (!segments.length || !parsed.namespaceLine || folders.length !== segments.length) continue;
    if (rootFolder?.toLowerCase() !== rootSegment?.toLowerCase()) continue;
    const index = segments.findIndex((segment, i) => segment !== folders[i] && segment.toLowerCase() === folders[i]!.toLowerCase());
    const sameIgnoringCase = segments.every((segment, i) => segment.toLowerCase() === folders[i]!.toLowerCase());
    if (index === -1 || !sameIgnoringCase) continue;
    findings.push({
      file,
      line: parsed.namespaceLine,
      severity: 'information',
      code: 'namespace-case',
      message: `Namespace segment "${segments[index]}" does not match its folder "${folders[index]}". PHP ignores letter case in class names, so this works today, but PSR-4 expects them to match and some autoloaders and case-sensitive servers do not forgive it.`,
      token: segments[index],
      replacement: folders[index],
    });
  }

  if (input.viewNames) {
    const sources = [
      ...[...input.classes.values()].map(({ parsed, file }) => ({ file, references: parsed.viewReferences })),
      ...input.routeFiles.map(({ file, source }) => ({ file, references: viewReferences(source) })),
    ];
    for (const { file, references } of sources) {
      for (const reference of references) {
        if (input.viewNames.has(reference.name)) continue;
        const suggestion = closest(reference.name, input.viewNames);
        findings.push({
          file,
          line: reference.line,
          severity: 'warning',
          code: 'missing-view',
          message: `View "${reference.name}" was not found in resources/views.${didYouMean(suggestion)}`,
          token: reference.name,
          replacement: suggestion,
        });
      }
    }
  }

  return findings.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
};

