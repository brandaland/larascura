import { describe, expect, it } from 'vitest';
import { explainSyntax, parseMiddlewareAliases, parsePhpClass, parseRoutes } from '../src/phpParser.js';

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

  it('skips scalar constructor parameters and reports exact multiline source lines', () => {
    const parsed = parsePhpClass('app/Services/Client.php', [
      '<?php',
      'namespace App\\Services;',
      'class Client {',
      '    public function __construct(',
      '        private string $apiKey,',
      '        private readonly Transport $transport,',
      '        private int $retries = 3,',
      '    ) {}',
      '}',
    ].join('\n'));

    expect(parsed?.dependencies).toEqual([
      { type: 'App\\Services\\Transport', variable: 'transport', line: 6 },
    ]);
  });

  it('does not carry an abstract constructor into the next method body', () => {
    const parsed = parsePhpClass('app/Services/AbstractClient.php', [
      '<?php',
      'namespace App\\Services;',
      'abstract class AbstractClient {',
      '    abstract public function __construct(Transport $transport);',
      '    public function send(Payload $payload) {}',
      '}',
    ].join('\n'));

    expect(parsed?.dependencies).toEqual([]);
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

  it('classifies event class dispatch separately from jobs', () => {
    const parsed = parsePhpClass('app/Services/Billing.php', [
      '<?php',
      'namespace App\\Services;',
      'use App\\Events\\InvoicePaid;',
      'use App\\Jobs\\SendReceipt;',
      'class Billing {',
      '    public function finish() {',
      '        InvoicePaid::dispatch();',
      '        SendReceipt::dispatch();',
      '        Bus::dispatch($job);',
      '    }',
      '}',
    ].join('\n'));

    expect(parsed?.dispatches).toEqual([
      expect.objectContaining({ type: 'event', target: 'App\\Events\\InvoicePaid' }),
      expect.objectContaining({ type: 'job', target: 'App\\Jobs\\SendReceipt' }),
    ]);
  });

  it('parses match and resource routes with inherited group context', () => {
    const routes = parseRoutes([
      '<?php',
      'use App\\Http\\Controllers\\OrderController;',
      "Route::prefix('admin')->middleware(['auth', 'verified'])->group(function () {",
      "    Route::match(['get', 'post'], '/preview', [OrderController::class, 'preview']);",
      "    Route::resource('orders', OrderController::class)->only(['index', 'show']);",
      '});',
    ].join('\n'));

    expect(routes).toEqual([
      {
        method: 'GET|POST',
        uri: '/admin/preview',
        controller: 'App\\Http\\Controllers\\OrderController',
        action: 'preview',
        middleware: ['auth', 'verified'],
        line: 4,
      },
      {
        method: 'GET',
        uri: '/admin/orders',
        controller: 'App\\Http\\Controllers\\OrderController',
        action: 'index',
        middleware: ['auth', 'verified'],
        line: 5,
        fromResource: true,
        name: 'orders.index',
      },
      {
        method: 'GET',
        uri: '/admin/orders/{order}',
        controller: 'App\\Http\\Controllers\\OrderController',
        action: 'show',
        middleware: ['auth', 'verified'],
        line: 5,
        fromResource: true,
        name: 'orders.show',
      },
    ]);
  });

  it('extracts controller method injection, form requests, and route model binding types', () => {
    const parsed = parsePhpClass('app/Http/Controllers/PostController.php', [
      '<?php',
      'namespace App\\Http\\Controllers;',
      'use App\\Http\\Requests\\StorePostRequest;',
      'use App\\Models\\Post;',
      'use App\\Services\\Publisher;',
      'use Illuminate\\Http\\Request;',
      'class PostController extends Controller {',
      '    public function store(StorePostRequest $request, Publisher $publisher): RedirectResponse',
      '    {',
      '    }',
      '    public function show(',
      '        #[CurrentUser] ?Post $post,',
      '        array $options = [\'a\' => [1, 2]],',
      '    ) {}',
      '    protected function helper(Publisher $publisher) {}',
      '    public static function make(Publisher $publisher) {}',
      '}',
    ].join('\n'));

    expect(parsed?.dependencies).toEqual([]);
    expect(parsed?.methodDependencies).toEqual([
      { method: 'store', type: 'App\\Http\\Requests\\StorePostRequest', variable: 'request', line: 8 },
      { method: 'store', type: 'App\\Services\\Publisher', variable: 'publisher', line: 8 },
      { method: 'show', type: 'App\\Models\\Post', variable: 'post', line: 12 },
    ]);
  });

  it('ignores PHP built-in classes such as Closure in middleware handle()', () => {
    const parsed = parsePhpClass('app/Http/Middleware/ApiLang.php', [
      '<?php',
      'namespace App\\Http\\Middleware;',
      'use Closure;',
      'use App\\Services\\Locale;',
      'class ApiLang {',
      '    public function handle(Request $request, Closure $next, \\DateTimeInterface $at, Locale $locale) {}',
      '}',
    ].join('\n'));

    expect(parsed?.methodDependencies.map((dependency) => dependency.type)).toEqual([
      'App\\Http\\Middleware\\Request',
      'App\\Services\\Locale',
    ]);
  });

  it('classifies form requests and middleware by convention', () => {
    expect(parsePhpClass('app/Http/Requests/StorePostRequest.php', [
      '<?php', 'namespace App\\Http\\Requests;', 'class StorePostRequest extends FormRequest {}',
    ].join('\n'))?.kind).toBe('request');
    expect(parsePhpClass('app/Http/Middleware/EnsureAdmin.php', [
      '<?php', 'namespace App\\Http\\Middleware;', 'class EnsureAdmin {}',
    ].join('\n'))?.kind).toBe('middleware');
  });

  it('reads constructor parameters with nested defaults and union types', () => {
    const parsed = parsePhpClass('app/Services/Mailer.php', [
      '<?php',
      'namespace App\\Services;',
      'class Mailer {',
      '    public function __construct(',
      "        private array $headers = ['x' => ['y']],",
      '        private Transport|Fallback $transport = new Transport(),',
      '    ) {}',
      '}',
    ].join('\n'));

    expect(parsed?.dependencies).toEqual([
      { type: 'App\\Services\\Transport', variable: 'transport', line: 6 },
      { type: 'App\\Services\\Fallback', variable: 'transport', line: 6 },
    ]);
  });

  it('extracts listener handle() event type-hints and explicit listener registrations', () => {
    const listener = parsePhpClass('app/Listeners/SendShipmentNotification.php', [
      '<?php',
      'namespace App\\Listeners;',
      'use App\\Events\\OrderShipped;',
      'class SendShipmentNotification {',
      '    public function handle(OrderShipped $event): void {}',
      '}',
    ].join('\n'));
    expect(listener?.methodDependencies).toEqual([
      { method: 'handle', type: 'App\\Events\\OrderShipped', variable: 'event', line: 5 },
    ]);

    const provider = parsePhpClass('app/Providers/EventServiceProvider.php', [
      '<?php',
      'namespace App\\Providers;',
      'use App\\Events\\OrderShipped;',
      'use App\\Listeners\\SendShipmentNotification;',
      'use App\\Listeners\\UpdateStock;',
      'class EventServiceProvider {',
      '    protected $listen = [',
      '        OrderShipped::class => [',
      '            SendShipmentNotification::class,',
      '            UpdateStock::class,',
      '        ],',
      '    ];',
      '    public function boot(): void {',
      "        Event::listen(OrderShipped::class, [AuditLog::class, 'handle']);",
      '    }',
      '}',
    ].join('\n'));
    expect(provider?.listeners).toEqual([
      { event: 'App\\Events\\OrderShipped', listener: 'App\\Listeners\\SendShipmentNotification', line: 9 },
      { event: 'App\\Events\\OrderShipped', listener: 'App\\Listeners\\UpdateStock', line: 10 },
      { event: 'App\\Events\\OrderShipped', listener: 'App\\Providers\\AuditLog', line: 14 },
    ]);
  });

  it('reads middleware aliases from bootstrap/app.php and the HTTP kernel', () => {
    expect(parseMiddlewareAliases([
      '<?php',
      'use App\\Http\\Middleware\\EnsureAdmin;',
      'return Application::configure(basePath: dirname(__DIR__))',
      '    ->withMiddleware(function (Middleware $middleware) {',
      '        $middleware->alias([',
      "            'admin' => EnsureAdmin::class,",
      '        ]);',
      '    })->create();',
    ].join('\n'))).toEqual([{ alias: 'admin', target: 'App\\Http\\Middleware\\EnsureAdmin', line: 6 }]);

    expect(parseMiddlewareAliases([
      '<?php',
      'namespace App\\Http;',
      'class Kernel extends HttpKernel {',
      '    protected $middlewareAliases = [',
      "        'auth' => \\App\\Http\\Middleware\\Authenticate::class,",
      "        'role' => '\\Spatie\\Permission\\Middleware\\RoleMiddleware',",
      '    ];',
      '}',
    ].join('\n'))).toEqual([
      { alias: 'auth', target: 'App\\Http\\Middleware\\Authenticate', line: 5 },
      { alias: 'role', target: 'Spatie\\Permission\\Middleware\\RoleMiddleware', line: 6 },
    ]);
  });

  it('resolves class-based route middleware', () => {
    const routes = parseRoutes([
      '<?php',
      'use App\\Http\\Middleware\\EnsureAdmin;',
      "Route::middleware([EnsureAdmin::class, 'throttle:api'])->group(function () {",
      "    Route::get('/panel', PanelController::class)->middleware(EnsureAdmin::class.':strict');",
      '});',
    ].join('\n'));
    expect(routes[0]?.middleware).toEqual(['App\\Http\\Middleware\\EnsureAdmin', 'throttle:api']);
  });

  it('links routes inside Route::controller()->group() to the group controller', () => {
    const routes = parseRoutes([
      '<?php',
      'use App\\Http\\Controllers\\OrderController;',
      'use App\\Http\\Controllers\\InvoiceController;',
      "Route::controller(OrderController::class)->prefix('orders')->group(function () {",
      "    Route::get('/', 'index');",
      "    Route::post('/', 'store')->middleware('auth');",
      "    Route::get('/pdf', [InvoiceController::class, 'pdf']);",
      "    Route::controller(InvoiceController::class)->group(function () {",
      "        Route::get('/invoices', 'list');",
      '    });',
      '});',
      "Route::get('/outside', 'orphan');",
    ].join('\n'));

    expect(routes.map((route) => [route.method, route.uri, route.controller, route.action])).toEqual([
      ['GET', '/orders', 'App\\Http\\Controllers\\OrderController', 'index'],
      ['POST', '/orders', 'App\\Http\\Controllers\\OrderController', 'store'],
      ['GET', '/orders/pdf', 'App\\Http\\Controllers\\InvoiceController', 'pdf'],
      ['GET', '/orders/invoices', 'App\\Http\\Controllers\\InvoiceController', 'list'],
      ['GET', '/outside', undefined, undefined],
    ]);
  });

  it('expands string resource controllers and Route::resources()', () => {
    const routes = parseRoutes([
      '<?php',
      'use App\\Http\\Controllers\\PhotoController;',
      "Route::resource('tags', 'TagController')->only(['index']);",
      "Route::apiResource('admin/users', 'Admin\\\\UserController')->only(['show']);",
      'Route::resources([',
      "    'photos' => PhotoController::class,",
      "    'posts' => 'PostController',",
      ']);',
    ].join('\n'));

    const summary = routes.map((route) => `${route.method} ${route.uri} ${route.controller}@${route.action}`);
    expect(summary.slice(0, 2)).toEqual([
      'GET /tags TagController@index',
      'GET /admin/users/{user} Admin\\UserController@show',
    ]);
    expect(summary).toContain('GET /photos/{photo}/edit App\\Http\\Controllers\\PhotoController@edit');
    expect(summary).toContain('DELETE /posts/{post} PostController@destroy');
    expect(routes.filter((route) => route.controller === 'PostController')).toHaveLength(7);
  });

  it('reads whole closures, follows delegation, and keeps the middleware chained after them', () => {
    const routes = parseRoutes([
      '<?php',
      'use App\\Http\\Controllers\\CronController;',
      "Route::get('config', function (Request $request) {",
      "    if ($request->wantsJson()) { abort(403); }",
      '    return app(\\App\\Http\\Controllers\\Api\\HomeController::class)->config($request);',
      "})->middleware('auth');",
      "Route::get('/cron/run', function (Request $request, CronController $controller) use ($guard) {",
      '    $guard($request);',
      '    return $controller->run();',
      '});',
      "Route::get('/test-500', function () { abort(500); });",
      "Route::get('/arrow', fn () => (new \\App\\Http\\Controllers\\PageController)->about());",
      "Route::get('/after', [CronController::class, 'status']);",
    ].join('\n'));

    expect(routes.map((route) => [route.uri, route.controller, route.action, route.closure, route.middleware])).toEqual([
      ['/config', 'App\\Http\\Controllers\\Api\\HomeController', 'config', true, ['auth']],
      ['/cron/run', 'App\\Http\\Controllers\\CronController', 'run', true, []],
      ['/test-500', undefined, undefined, true, []],
      ['/arrow', 'App\\Http\\Controllers\\PageController', 'about', true, []],
      ['/after', 'App\\Http\\Controllers\\CronController', 'status', undefined, []],
    ]);
  });

  it('names routes with their group prefixes', () => {
    const routes = parseRoutes([
      '<?php',
      'use App\\Http\\Controllers\\ShippingController;',
      "Route::name('admin.')->prefix('admin')->group(function () {",
      "    Route::controller(ShippingController::class)->name('shipping.')->group(function () {",
      "        Route::get('methods', 'method')->name('method.index');",
      '    });',
      "    Route::resource('admin/users', ShippingController::class)->only(['index']);",
      '});',
    ].join('\n'));

    expect(routes.map((route) => route.name)).toEqual(['admin.shipping.method.index', 'admin.users.index']);
  });

  it('resolves qualified names through an imported first segment or the current namespace, like PHP', () => {
    const parsed = parsePhpClass('app/Models/Post.php', [
      '<?php',
      'namespace App\\Models;',
      'use App\\Domain;',
      'use App\\Accounting\\Ledgers as Books;',
      'use App\\Support\\Tags\\Tag as Label;',
      'class Post extends Model {',
      '    public function comments() { return $this->hasMany(Domain\\Blog\\Comment::class); }',
      '    public function invoice() { return $this->hasOne(Billing\\Invoice::class); }',
      '    public function author() { return $this->belongsTo(\\App\\Models\\User::class); }',
      '    public function ledger() { return $this->belongsTo(Books\\Ledger::class); }',
      '    public function labels() { return $this->hasMany(Label::class); }',
      '    public function category() { return $this->belongsTo(Category::class); }',
      '}',
    ].join('\n'));

    expect(parsed?.relations.map((relation) => relation.target)).toEqual([
      'App\\Domain\\Blog\\Comment', // imported first segment
      'App\\Models\\Billing\\Invoice', // qualified, relative to the current namespace
      'App\\Models\\User', // leading backslash: already fully qualified
      'App\\Accounting\\Ledgers\\Ledger', // aliased first segment
      'App\\Support\\Tags\\Tag', // aliased class
      'App\\Models\\Category', // unqualified, current namespace
    ]);
  });

  it('explains common Laravel syntax without a network service', () => {
    expect(explainSyntax("Route::post('/orders', [OrderController::class, 'store']);", 'tr')).toContain(
      'HTTP adresini',
    );
    expect(explainSyntax('return $this->hasMany(Order::class);', 'en')).toContain('Eloquent relationship');
  });
});
