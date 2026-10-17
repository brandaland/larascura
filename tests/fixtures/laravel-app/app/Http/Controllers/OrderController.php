<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreOrderRequest;
use App\Models\Order;
use App\Services\Checkout;
use Illuminate\Http\Request;

class OrderController extends Controller
{
    public function store(StoreOrderRequest $request, Checkout $checkout)
    {
        return $checkout->place($request->validated());
    }

    public function show(Request $request, Order $order)
    {
        return $order;
    }
}
