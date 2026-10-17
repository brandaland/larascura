<?php

namespace App\Services;

use App\Events\OrderPlaced;

class Checkout
{
    public function place(array $data)
    {
        event(new OrderPlaced());
    }
}
