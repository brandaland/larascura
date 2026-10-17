<?php

namespace App\Services;

use App\Events\OrderPlaced;
use Domain\Billing\InvoiceService;

class Checkout
{
    public function __construct(private InvoiceService $invoices)
    {
    }

    public function place(array $data)
    {
        event(new OrderPlaced());
    }
}
