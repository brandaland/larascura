import { describe, expect, it } from 'vitest';
import { inertiaRenders, pageDirectoryFrom, sharedProps, vuePageProps } from '../src/inertia.js';

const php = (...lines: string[]): string => ['<?php', ...lines].join('\n');
const vue = (...lines: string[]): string => ['<template><div /></template>', '<script setup lang="ts">', ...lines, '</script>'].join('\n');

describe('Inertia render calls', () => {
  it('reads page names and literal props, and treats payload builders as unknown', () => {
    const renders = inertiaRenders(php(
      "return Inertia::render('UkTrend', [",
      "    'seo' => StorefrontSeo::make('UK', 'Trends', route('uk.trends')),",
      "    'trends' => $trends->payload(auth_user('web'), null, 2),",
      ']);',
      "return inertia('Users/Index', compact('users', 'filters'));",
      "return Inertia::render('DirectoryPage', FrontendSimplePagePayload::faqs($title, $faqs));",
      "return Inertia::render('Dashboard');",
      "return Inertia::render('Orders/Show', ['order' => $order])->with('flash', 'Saved');",
      "return Inertia::render('Spread', [...$base, 'extra' => 1]);",
      "return Inertia::render('Merged', ['a' => 1])->with(['b' => 2]);",
      "Route::inertia('/about', 'About');",
    ));

    expect(renders).toEqual([
      { page: 'UkTrend', line: 2, props: ['seo', 'trends'] },
      { page: 'Users/Index', line: 6, props: ['users', 'filters'] },
      { page: 'DirectoryPage', line: 7, props: undefined },
      { page: 'Dashboard', line: 8, props: [] },
      { page: 'Orders/Show', line: 9, props: ['order', 'flash'] },
      { page: 'Spread', line: 10, props: undefined },
      { page: 'Merged', line: 11, props: undefined },
    ]);
  });

  it('reads shared props from HandleInertiaRequests::share()', () => {
    expect(sharedProps(php(
      'class HandleInertiaRequests extends Middleware {',
      '    public function share(Request $request): array',
      '    {',
      '        return [',
      '            ...parent::share($request),',
      "            'auth' => ['user' => $request->user()],",
      "            'flash' => fn () => ['ok' => session('ok')],",
      '        ];',
      '    }',
      '}',
    ))).toEqual({ keys: ['errors', 'auth', 'flash'], complete: true });

    expect(sharedProps(php(
      'class HandleInertiaRequests extends Middleware {',
      '    public function share(Request $request): array {',
      "        return array_merge(parent::share($request), ['locale' => app()->getLocale(), ...$this->extra()]);",
      '    }',
      '}',
    ))).toEqual({ keys: ['errors', 'locale'], complete: false });
  });
});

describe('Vue page props', () => {
  it('reads a type literal with optional props', () => {
    expect(vuePageProps(vue(
      "import type { SeoPayload } from '@/types';",
      'defineProps<{',
      '    seo?: SeoPayload;',
      '    trends: RegionalTrendPayload;',
      '    onPick: (id: number) => void;',
      '    nested: { a: string; b: number };',
      '}>();',
    ))).toEqual({
      props: [
        { name: 'seo', required: false },
        { name: 'trends', required: true },
        { name: 'onPick', required: true },
        { name: 'nested', required: true },
      ],
      complete: true,
      line: 4,
    });
  });

  it('follows defineProps<Props>() to an interface in the same file, and flags extends as incomplete', () => {
    const local = vuePageProps(vue('interface TicketDetailProps {', '  title: string', '  links?: Links', '}', 'defineProps<TicketDetailProps>();'));
    expect(local?.props).toEqual([{ name: 'title', required: true }, { name: 'links', required: false }]);
    expect(local?.complete).toBe(true);

    const extended = vuePageProps(vue('interface Props extends BaseProps { title: string }', 'withDefaults(defineProps<Props>(), { title: "" });'));
    expect(extended?.complete).toBe(false);

    expect(vuePageProps(vue("import type { Props } from './types';", 'defineProps<Props>();'))).toBeUndefined();
  });

  it('reads runtime object and array declarations and the Options API', () => {
    expect(vuePageProps(vue('defineProps({ users: { type: Array, required: true }, filters: Object });'))?.props).toEqual([
      { name: 'users', required: true },
      { name: 'filters', required: false },
    ]);
    expect(vuePageProps(vue("defineProps(['users', 'filters']);"))?.props).toEqual([
      { name: 'users', required: false },
      { name: 'filters', required: false },
    ]);
    expect(vuePageProps(['<script>', 'export default { props: { posts: { type: Array, required: true } } }', '</script>'].join('\n'))?.props)
      .toEqual([{ name: 'posts', required: true }]);
    expect(vuePageProps(vue('const page = usePage();'))).toBeUndefined();
  });
});

describe('Inertia page directory', () => {
  it('reads the pages folder from the app entry', () => {
    expect(pageDirectoryFrom("const pages = import.meta.glob<{ default: DefineComponent }>('./Pages/**/*.vue');")).toEqual({ directory: 'Pages', extension: 'vue' });
    expect(pageDirectoryFrom('resolve: (name) => resolvePageComponent(`./pages/${name}.vue`, import.meta.glob("./pages/**/*.vue"))'))
      .toEqual({ directory: 'pages', extension: 'vue' });
    expect(pageDirectoryFrom("createApp(App).mount('#app')")).toBeUndefined();
  });
});
