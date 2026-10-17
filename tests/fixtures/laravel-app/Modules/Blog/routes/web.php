<?php

use Illuminate\Support\Facades\Route;
use Modules\Blog\Http\Controllers\PostController;

Route::get('/blog', [PostController::class, 'index']);
