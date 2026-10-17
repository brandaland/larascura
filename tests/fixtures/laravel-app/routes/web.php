<?php

use App\Http\Controllers\OrderController;
use Illuminate\Support\Facades\Route;

Route::middleware(['web', 'auth'])->group(function () {
    Route::post('/orders', [OrderController::class, 'store'])->middleware('throttle:10,1');
    Route::get('/orders/{order}', [OrderController::class, 'show'])->middleware('admin');
    Route::get('/legacy', [OrderController::class, 'legacy'])->middleware('mystery');
});

Route::get('/orders-list', [OrderController::class, 'index']);
Route::get('/dashboard', \App\Http\Controllers\DashboardController::class);
Route::inertia('/about', 'About');
