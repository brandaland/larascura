const alwaysScanned = ['app', 'routes'];
// Factories, seeders and tests are PSR-4 mapped too, but they are not part of the request architecture.
const ignoredPrefixes = ['database', 'tests', 'vendor', 'storage', 'bootstrap', 'node_modules'];

const normalizeDirectory = (value: string): string =>
  value.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * Returns the project-relative directories LaraScura should scan: app/ and routes/, every
 * PSR-4 autoload directory from composer.json, and Modules/ when the project uses modules.
 * Nested directories are folded into their parent so no file is read twice.
 */
export const sourceDirectories = (composerJson: string | undefined, hasModulesDirectory: boolean): string[] => {
  const candidates = [...alwaysScanned];
  if (hasModulesDirectory) candidates.push('Modules');

  try {
    const composer = JSON.parse(composerJson ?? '{}') as { autoload?: { 'psr-4'?: Record<string, string | string[]> } };
    for (const target of Object.values(composer.autoload?.['psr-4'] ?? {})) {
      candidates.push(...(Array.isArray(target) ? target : [target]));
    }
  } catch {
    // An unreadable composer.json still leaves the Laravel defaults.
  }

  const directories = [...new Set(candidates.map(normalizeDirectory))]
    .filter((directory) => directory && !directory.startsWith('..') && !directory.startsWith('/'))
    .filter((directory) => !ignoredPrefixes.some((prefix) => directory === prefix || directory.startsWith(`${prefix}/`)))
    .sort((left, right) => left.length - right.length || left.localeCompare(right));

  return directories
    .filter((directory, index) => !directories.slice(0, index).some((parent) => directory.startsWith(`${parent}/`)))
    .sort((left, right) => left.localeCompare(right));
};

export const phpGlob = (directories: string[]): string =>
  directories.length === 1 ? `${directories[0]}/**/*.php` : `{${directories.join(',')}}/**/*.php`;

/** Route files live in routes/ at the root or inside a module (Modules/Blog/routes/web.php). */
export const isRouteFile = (relativePath: string): boolean => /(^|\/)routes\/[^/]+\.php$/i.test(relativePath);
