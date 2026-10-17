import { describe, expect, it } from 'vitest';
import { ambiguousClassNames, createClassNameIndex, resolveClassName } from '../src/classResolver.js';

describe('class name resolver', () => {
  it('resolves unique short names without guessing ambiguous names', () => {
    const index = createClassNameIndex([
      'App\\Http\\Controllers\\Admin\\LoginController',
      'App\\Http\\Controllers\\Portal\\LoginController',
      'App\\Services\\BillingService',
    ]);

    expect(resolveClassName(index, 'BillingService')).toBe('App\\Services\\BillingService');
    expect(resolveClassName(index, 'LoginController')).toBe('LoginController');
    expect(resolveClassName(index, 'App\\Http\\Controllers\\Portal\\LoginController')).toBe(
      'App\\Http\\Controllers\\Portal\\LoginController',
    );
    expect(ambiguousClassNames(index)).toEqual(['LoginController']);
  });
});
