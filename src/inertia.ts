import { balancedEnd, lineNumber, phpArrayKeys, topLevelParts } from './phpParser.js';

export interface InertiaRender {
  page: string;
  line: number;
  /** Prop names passed to the page, or undefined when they are built dynamically (payload classes, variables). */
  props?: string[];
}

export interface PageProp {
  name: string;
  required: boolean;
}

export interface PageProps {
  props: PageProp[];
  /** False when the page can also receive props declared elsewhere (an imported type, `extends`). */
  complete: boolean;
  line: number;
}

const quotedKey = /^\s*(['"])([\w.-]+)\1\s*=>/;

/** Props passed by a render call's second argument: an array literal or compact('a', 'b'). */
const propsArgument = (source: string, from: number): { props?: string[]; end: number } => {
  const rest = source.slice(from);
  const array = /^\s*,\s*\[/.exec(rest);
  if (array) {
    const open = from + array[0].length - 1;
    const end = balancedEnd(source, open);
    return end === undefined ? { end: from } : { props: phpArrayKeys(source.slice(open + 1, end - 1)), end };
  }
  const compact = /^\s*,\s*compact\s*\(([^)]*)\)/.exec(rest);
  if (compact) {
    const names = [...(compact[1] ?? '').matchAll(/['"](\w+)['"]/g)].flatMap((match) => (match[1] ? [match[1]] : []));
    return { props: names, end: from + compact[0].length };
  }
  // No second argument means no props; anything else (a variable, a payload builder) is unknown.
  return /^\s*\)/.test(rest) ? { props: [], end: from } : { end: from };
};

/** Inertia::render('Page', [...]) and inertia('Page', [...]) calls, plus ->with() props chained after them. */
export const inertiaRenders = (source: string): InertiaRender[] => {
  const renders: InertiaRender[] = [];
  // The lookbehind keeps Route::inertia('/about', 'About') out: there the first string is a URL, not a page.
  for (const match of source.matchAll(/(?:Inertia::render|(?<![\w:>$])inertia)\s*\(\s*(['"])([^'"$]+)\1/g)) {
    if (match.index === undefined || !match[2]) continue;
    const argument = propsArgument(source, match.index + match[0].length);
    let props = argument.props;
    const call = balancedEnd(source, source.indexOf('(', match.index));
    // ->with('key', ...) adds props; ->with([...]) adds keys we would have to guess, so props become unknown.
    let rest = call === undefined ? '' : source.slice(call);
    while (props && /^\s*->\s*with\s*\(/.test(rest)) {
      const chained = /^\s*->\s*with\s*\(\s*(['"])(\w+)\1/.exec(rest);
      const close = balancedEnd(rest, rest.indexOf('('));
      if (!chained?.[2] || close === undefined) {
        props = undefined;
        break;
      }
      props = [...props, chained[2]];
      rest = rest.slice(close);
    }
    renders.push({ page: match[2], line: lineNumber(source, match.index), props });
  }
  return renders;
};

/** Keys returned by HandleInertiaRequests::share(); parent::share() always contributes `errors`. */
export const sharedProps = (source: string): { keys: string[]; complete: boolean } | undefined => {
  const method = /function\s+share\s*\([^)]*\)[^{]*\{/.exec(source);
  if (!method) return undefined;
  const bodyStart = method.index + method[0].length;
  const returned = /return\s+(array_merge\s*\(\s*parent::share\s*\([^)]*\)\s*,\s*)?\[/.exec(source.slice(bodyStart));
  if (!returned) return { keys: ['errors'], complete: false };
  const open = bodyStart + returned.index + returned[0].length - 1;
  const end = balancedEnd(source, open);
  if (end === undefined) return { keys: ['errors'], complete: false };
  const keys = ['errors'];
  let complete = true;
  for (const part of topLevelParts(source.slice(open + 1, end - 1))) {
    const text = part.text.trim();
    if (!text) continue;
    if (/^\.\.\.\s*parent::share\s*\(/.test(text)) continue;
    const key = quotedKey.exec(part.text);
    if (key?.[2]) keys.push(key[2]);
    else complete = false;
  }
  return { keys, complete };
};

// Splits a JS/TS object or type body at top-level separators, skipping strings and nested brackets.
const topLevelMembers = (body: string, separators: RegExp): string[] => {
  const members: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? '';
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '=' && body[index + 1] === '>') index += 1;
    else if ('{[(<'.includes(character)) depth += 1;
    else if ('}])>'.includes(character)) depth -= 1;
    else if (depth === 0 && separators.test(character)) {
      members.push(body.slice(start, index));
      start = index + 1;
    }
  }
  members.push(body.slice(start));
  return members.map((member) => member.trim()).filter(Boolean);
};

// Index just after the bracket closing the one at `open`, for ( [ { and TS generics < >.
const closingIndex = (source: string, open: number): number | undefined => {
  let depth = 0;
  let quote = '';
  for (let index = open; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') quote = character;
    else if (character === '=' && source[index + 1] === '>') index += 1;
    else if ('{[(<'.includes(character)) depth += 1;
    else if ('}])>'.includes(character)) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return undefined;
};

const typeMembers = (body: string): PageProp[] =>
  topLevelMembers(body, /[;,\n]/).flatMap((member) => {
    const declaration = /^(?:readonly\s+)?(['"]?)([\w$]+)\1(\?)?\s*:/.exec(member);
    return declaration?.[2] ? [{ name: declaration[2], required: !declaration[3] }] : [];
  });

const runtimeMembers = (body: string): PageProp[] =>
  topLevelMembers(body, /[,]/).flatMap((member) => {
    const declaration = /^(['"]?)([\w$]+)\1\s*:([\s\S]*)$/.exec(member);
    if (!declaration?.[2]) return [];
    return [{ name: declaration[2], required: /required\s*:\s*true/.test(declaration[3] ?? '') }];
  });

/** Props a Vue page declares with defineProps (type, interface, object or array form) or the Options API. */
export const vuePageProps = (source: string): PageProps | undefined => {
  const script = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '').join('\n');
  const lineOf = (index: number): number => {
    const snippet = script.slice(index, index + 24);
    return lineNumber(source, Math.max(0, source.indexOf(snippet)));
  };

  const generic = /defineProps\s*</.exec(script);
  if (generic) {
    const open = generic.index + generic[0].length - 1;
    const end = closingIndex(script, open);
    if (end === undefined) return undefined;
    const argument = script.slice(open + 1, end - 1).trim();
    if (argument.startsWith('{')) return { props: typeMembers(argument.slice(1, -1)), complete: true, line: lineOf(generic.index) };
    // defineProps<Props>() with Props declared in this file.
    const named = new RegExp(`(?:interface\\s+${argument}(\\s+extends\\s+[^{]+)?\\s*\\{|type\\s+${argument}\\s*=\\s*\\{)`).exec(script);
    if (!/^[\w$]+$/.test(argument) || !named) return undefined;
    const bodyOpen = named.index + named[0].length - 1;
    const bodyEnd = closingIndex(script, bodyOpen);
    if (bodyEnd === undefined) return undefined;
    return { props: typeMembers(script.slice(bodyOpen + 1, bodyEnd - 1)), complete: !named[1], line: lineOf(generic.index) };
  }

  const runtime = /(?:defineProps\s*\(|\bprops\s*:)\s*([{[])/.exec(script);
  if (!runtime) return undefined;
  const open = runtime.index + runtime[0].length - 1;
  const end = closingIndex(script, open);
  if (end === undefined) return undefined;
  const body = script.slice(open + 1, end - 1);
  const props = runtime[1] === '['
    ? [...body.matchAll(/['"]([\w$]+)['"]/g)].flatMap((match) => (match[1] ? [{ name: match[1], required: false }] : []))
    : runtimeMembers(body);
  return { props, complete: true, line: lineOf(runtime.index) };
};

/**
 * Where Inertia looks for pages, read from import.meta.glob('./Pages/**\/*.vue') or
 * resolvePageComponent(`./Pages/${name}.vue`) in the app entry.
 */
export const pageDirectoryFrom = (entrySource: string): { directory: string; extension: string } | undefined => {
  const glob = /import\.meta\.glob\s*(?:<[^>]*>)?\s*\(\s*['"`]\.\/([\w/-]+?)\/\*\*\/\*\.(\w+)['"`]/.exec(entrySource);
  if (glob?.[1] && glob[2]) return { directory: glob[1], extension: glob[2] };
  const resolve = /['"`]\.\/([\w/-]+?)\/\$\{\s*\w+\s*\}\.(\w+)['"`]/.exec(entrySource);
  if (resolve?.[1] && resolve[2]) return { directory: resolve[1], extension: resolve[2] };
  return undefined;
};
