import { describe, expect, it } from 'vitest';
import { isRouteFile, phpGlob, sourceDirectories } from '../src/projectLayout.js';

describe('project layout', () => {
  it('adds PSR-4 directories, folds nested ones, and skips database and tests', () => {
    const composer = JSON.stringify({
      autoload: {
        'psr-4': {
          'App\\': 'app/',
          'App\\Domain\\': 'app/Domain/',
          'Domain\\': ['src/Domain/', './src/Support'],
          'Database\\Seeders\\': 'database/seeders/',
          'Tests\\': 'tests/',
          'Escape\\': '../outside/',
        },
      },
    });

    expect(sourceDirectories(composer, true)).toEqual(['app', 'Modules', 'routes', 'src/Domain', 'src/Support']);
  });

  it('falls back to the Laravel defaults when composer.json is missing or broken', () => {
    expect(sourceDirectories(undefined, false)).toEqual(['app', 'routes']);
    expect(sourceDirectories('{not json', false)).toEqual(['app', 'routes']);
  });

  it('builds a glob and recognizes root and module route files', () => {
    expect(phpGlob(['app', 'routes'])).toBe('{app,routes}/**/*.php');
    expect(isRouteFile('routes/web.php')).toBe(true);
    expect(isRouteFile('Modules/Blog/routes/api.php')).toBe(true);
    expect(isRouteFile('Modules/Blog/Routes/web.php')).toBe(true);
    expect(isRouteFile('app/Http/Controllers/RoutesController.php')).toBe(false);
  });
});
