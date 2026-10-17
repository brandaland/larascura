import { describe, expect, it } from 'vitest';
import { closest, diagnose, editDistance, type DoctorInput } from '../src/doctor.js';
import { parsePhpClass, parseRoutes } from '../src/phpParser.js';

const php = (...lines: string[]): string => ['<?php', ...lines].join('\n');

const classes = (...files: Array<[string, string]>): DoctorInput['classes'] => {
  const map: DoctorInput['classes'] = new Map();
  for (const [file, source] of files) {
    const parsed = parsePhpClass(file, source);
    if (parsed) map.set(parsed.qualifiedName, { parsed, file });
  }
  return map;
};

const routes = (source: string) => [{ file: 'routes/web.php', source, routes: parseRoutes(source) }];

const input = (overrides: Partial<DoctorInput>): DoctorInput => ({
  classes: new Map(),
  routeFiles: [],
  knownMiddleware: new Set(['auth', 'guest', 'throttle', 'web', 'api']),
  unresolvedMiddleware: new Set(),
  ...overrides,
});

const baseController: [string, string] = [
  'app/Http/Controllers/Controller.php',
  php('namespace App\\Http\\Controllers;', 'abstract class Controller {}'),
];
const orderController = (...body: string[]): [string, string] => [
  'app/Http/Controllers/OrderController.php',
  php('namespace App\\Http\\Controllers;', 'class OrderController extends Controller {', ...body, '}'),
];
const routeFile = (...lines: string[]) => php('use App\\Http\\Controllers\\OrderController;', ...lines);

describe('typo distance', () => {
  it('counts a swapped pair of letters as one edit and refuses ties', () => {
    expect(editDistance('atuh', 'auth')).toBe(1);
    expect(editDistance('indx', 'index')).toBe(1);
    expect(closest('atuh', ['auth', 'guest'])).toBe('auth');
    expect(closest('cat', ['bat', 'hat'])).toBeUndefined();
    expect(closest('dashboard', ['auth'])).toBeUndefined();
  });
});

describe('LaraScura Doctor', () => {
  it('flags a misspelled controller action with a quick fix, but accepts PHP case-insensitive names', () => {
    const findings = diagnose(input({
      classes: classes(baseController, orderController('public function index() {}', 'public function store() {}')),
      routeFiles: routes(routeFile(
        "Route::get('/orders', [OrderController::class, 'indx']);",
        "Route::post('/orders', [OrderController::class, 'Store']);",
      )),
    }));

    expect(findings).toEqual([expect.objectContaining({
      line: 3,
      severity: 'warning',
      code: 'missing-action',
      token: 'indx',
      replacement: 'index',
    })]);
    expect(findings[0]?.message).toContain('Did you mean "index"?');
  });

  it('flags a single-action controller without __invoke()', () => {
    const findings = diagnose(input({
      classes: classes(baseController, orderController('public function index() {}')),
      routeFiles: routes(routeFile("Route::get('/orders', OrderController::class);")),
    }));

    expect(findings.map((finding) => finding.code)).toEqual(['missing-invoke']);
  });

  it('advises ->except() for resource actions the controller does not implement', () => {
    const findings = diagnose(input({
      classes: classes(baseController, orderController(
        'public function index() {}', 'public function store() {}', 'public function show() {}',
        'public function update() {}', 'public function destroy() {}',
      )),
      routeFiles: routes(routeFile("Route::resource('orders', OrderController::class);")),
    }));

    expect(findings).toEqual([expect.objectContaining({ severity: 'information', code: 'resource-actions', line: 3 })]);
    expect(findings[0]?.message).toContain("->except(['create', 'edit'])");
  });

  it('stays silent when the action may come from a trait, an unknown parent, or __call()', () => {
    const route = routes(routeFile("Route::get('/orders', [OrderController::class, 'export']);"));
    const variants: Array<[string, string]> = [
      orderController('use ExportsCsv;'),
      ['app/Http/Controllers/OrderController.php', php('namespace App\\Http\\Controllers;', 'class OrderController extends \\Vendor\\Admin\\CrudController {}')],
      orderController('public function __call($name, $arguments) {}'),
    ];

    for (const variant of variants) {
      expect(diagnose(input({ classes: classes(baseController, variant), routeFiles: route }))).toEqual([]);
    }
  });

  it('still checks controllers that use the framework authorization and validation traits', () => {
    const findings = diagnose(input({
      classes: classes(
        ['app/Http/Controllers/Controller.php', php(
          'namespace App\\Http\\Controllers;',
          'use Illuminate\\Foundation\\Auth\\Access\\AuthorizesRequests;',
          'use Illuminate\\Foundation\\Validation\\ValidatesRequests;',
          'use Illuminate\\Routing\\Controller as BaseController;',
          'class Controller extends BaseController {',
          '    use AuthorizesRequests, ValidatesRequests;',
          '}',
        )],
        orderController('public function index() {}'),
      ),
      routeFiles: routes(routeFile("Route::get('/orders', [OrderController::class, 'indx']);")),
    }));

    expect(findings.map((finding) => finding.replacement)).toEqual(['index']);
  });

  it('flags a missing project controller with a suggestion but ignores vendor controllers', () => {
    const findings = diagnose(input({
      classes: classes(baseController, orderController('public function index() {}')),
      routeFiles: routes(php(
        'use App\\Http\\Controllers\\OrderControler;',
        'use Laravel\\Fortify\\Http\\Controllers\\LoginController;',
        "Route::get('/orders', [OrderControler::class, 'index']);",
        "Route::post('/login', [LoginController::class, 'store']);",
      )),
    }));

    expect(findings).toEqual([expect.objectContaining({ code: 'missing-controller', line: 4, token: 'OrderControler' })]);
    expect(findings[0]?.message).toContain('Did you mean "OrderController"?');
    // Changing the route line alone would leave the import wrong, so there is no automatic fix.
    expect(findings[0]?.replacement).toBeUndefined();
  });

  it('flags misspelled middleware where it is written, and ignores unknown aliases with no close match', () => {
    const findings = diagnose(input({
      unresolvedMiddleware: new Set(['atuh', 'role']),
      routeFiles: routes(php(
        "Route::middleware(['atuh', 'role:admin'])->group(function () {",
        "    Route::get('/a', fn () => 1);",
        "    Route::get('/b', fn () => 2)->middleware('atuh:sanctum');",
        '});',
      )),
    }));

    expect(findings.map((finding) => [finding.line, finding.token, finding.replacement])).toEqual([
      [2, 'atuh', 'auth'],
      [4, 'atuh', 'auth'],
    ]);
  });

  it('warns that only the last of two identical routes runs', () => {
    const findings = diagnose(input({
      classes: classes(baseController, orderController('public function index() {}', 'public function all() {}')),
      routeFiles: routes(routeFile(
        "Route::get('/orders', [OrderController::class, 'index']);",
        "Route::get('/orders', [OrderController::class, 'all']);",
      )),
    }));

    expect(findings).toEqual([expect.objectContaining({ code: 'duplicate-route', line: 4, severity: 'warning' })]);
    expect(findings[0]?.message).toContain('already defined on line 3');
  });

  it('flags a relation to a model that does not exist, with a fix only when no import is involved', () => {
    const findings = diagnose(input({
      classes: classes(
        ['app/Models/Comment.php', php('namespace App\\Models;', 'class Comment extends Model {}')],
        ['app/Models/Post.php', php(
          'namespace App\\Models;',
          'use App\\Billing\\Invoyce;',
          'class Post extends Model {',
          '    public function comments() { return $this->hasMany(Coment::class); }',
          '    public function invoice() { return $this->hasOne(Invoyce::class); }',
          '    public function author() { return $this->belongsTo(\\Illuminate\\Foundation\\Auth\\User::class); }',
          '}',
        )],
      ),
    }));

    expect(findings.map((finding) => [finding.line, finding.token, finding.replacement])).toEqual([
      [5, 'Coment', 'Comment'],
      [6, 'Invoyce', undefined],
    ]);
  });

  it('flags missing views, skips dynamic and package views, and skips the check when views are not known', () => {
    const controller = orderController(
      "public function index() { return view('orders.indx'); }",
      "public function show() { return view('orders.' . $type); }",
      "public function mail() { return view('mail::message'); }",
      "public function slash() { return view('orders/index'); }",
    );
    const viewNames = new Set(['orders.index', 'layouts.app']);

    const findings = diagnose(input({ classes: classes(baseController, controller), viewNames }));
    expect(findings).toEqual([expect.objectContaining({ code: 'missing-view', token: 'orders.indx', replacement: 'orders.index', line: 4 })]);
    expect(diagnose(input({ classes: classes(baseController, controller) }))).toEqual([]);
  });

  it('treats class names case-insensitively like PHP and only suggests matching the folder case', () => {
    const findings = diagnose(input({
      classes: classes(baseController, [
        'app/Http/Controllers/Api/UserController.php',
        php('namespace App\\Http\\Controllers\\api;', 'use App\\Http\\Controllers\\Controller;', 'class UserController extends Controller {', 'public function index() {}', '}'),
      ]),
      routeFiles: routes(php("Route::get('/users', [\\App\\Http\\Controllers\\Api\\UserController::class, 'index']);")),
    }));

    expect(findings).toEqual([expect.objectContaining({
      code: 'namespace-case', severity: 'information', line: 2, token: 'api', replacement: 'Api',
    })]);

    const copiedLibrary = diagnose(input({
      classes: classes(['app/Payment/razorpay-php/tests/ApiTest.php', php('namespace Razorpay\\Tests;', 'class ApiTest {}')]),
    }));
    expect(copiedLibrary).toEqual([]);
  });
});
