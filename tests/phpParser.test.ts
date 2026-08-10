import { describe, expect, it } from 'vitest';
import { explainSyntax, parsePhpClass, parseRoutes } from '../src/phpParser.js';

describe('Laravel PHP syntax parser', () => {
  it('maps route syntax to controller actions and middleware', () => {
    const routes = parseRoutes([
      '<?php',
      'use App\\\\Http\\\\Controllers\\\\OrderController;',
      '',
      "Route::get('/orders', [OrderController::class, 'index'])->middleware(['auth', 'verified']);",
      "Route::post('/orders', OrderController::class);",
    ].join('\n'));

    expect(routes).toEqual([
      {
        method: 'GET',
        uri: '/orders',
        controller: 'App\\\\Http\\\\Controllers\\\\OrderController',
        action: 'index',
        middleware: ['auth', 'verified'],
        line: 4,
      },
      {
        method: 'POST',
        uri: '/orders',
        controller: 'App\\\\Http\\\\Controllers\\\\OrderController',
        action: '__invoke',
        middleware: [],
        line: 5,
      },
    ]);
  });

  it('extracts constructor injection with resolved imports', () => {
    const parsed = parsePhpClass('app/Http/Controllers/OrderController.php', [
      '<?php',
      'namespace App\\\\Http\\\\Controllers;',
      '',
      'use App\\\\Services\\\\CreateOrderService;',
      '',
      'final class OrderController',
      '{',
      '    public function __construct(private readonly CreateOrderService $orders) {}',
      '}',
    ].join('\n'));

    expect(parsed?.kind).toBe('controller');
    expect(parsed?.dependencies).toEqual([
      { type: 'App\\\\Services\\\\CreateOrderService', variable: 'orders', line: 8 },
    ]);
  });

  it('extracts Eloquent relationships', () => {
    const parsed = parsePhpClass('app/Models/Order.php', [
      '<?php',
      'namespace App\\\\Models;',
      '',
      'use Illuminate\\\\Database\\\\Eloquent\\\\Model;',
      'use App\\\\Models\\\\Customer;',
      '',
      'class Order extends Model',
      '{',
      '    public function customer()',
      '    {',
      '        return $this->belongsTo(Customer::class);',
      '    }',
      '}',
    ].join('\n'));

    expect(parsed?.kind).toBe('model');
    expect(parsed?.relations).toEqual([
      { type: 'belongsTo', target: 'App\\\\Models\\\\Customer', line: 11 },
    ]);
  });

  it('extracts jobs, events, and service-container bindings', () => {
    const source = [
      '<?php',
      'namespace App\\\\Providers;',
      'use App\\\\Contracts\\\\Billing;',
      'use App\\\\Services\\\\StripeBilling;',
      'use App\\\\Jobs\\\\SendInvoiceJob;',
      'use App\\\\Events\\\\InvoicePaid;',
      '',
      'class AppServiceProvider',
      '{',
      '    public function register()',
      '    {',
      '        $this->app->bind(Billing::class, StripeBilling::class);',
      '        SendInvoiceJob::dispatch();',
      '        event(new InvoicePaid());',
      '    }',
      '}',
    ].join('\n');
    const parsed = parsePhpClass('app/Providers/AppServiceProvider.php', source);

    expect(parsed?.bindings[0]).toMatchObject({
      abstract: 'App\\\\Contracts\\\\Billing',
      concrete: 'App\\\\Services\\\\StripeBilling',
    });
    expect(parsed?.dispatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'job', target: 'App\\\\Jobs\\\\SendInvoiceJob' }),
        expect.objectContaining({ type: 'event', target: 'App\\\\Events\\\\InvoicePaid' }),
      ]),
    );
  });

  it('explains common Laravel syntax without a network service', () => {
    expect(explainSyntax("Route::post('/orders', [OrderController::class, 'store']);", 'tr')).toContain(
      'HTTP adresini',
    );
    expect(explainSyntax('return $this->hasMany(Order::class);', 'en')).toContain('Eloquent relationship');
  });
});
