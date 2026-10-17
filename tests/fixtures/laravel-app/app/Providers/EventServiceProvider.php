<?php

namespace App\Providers;

use App\Events\OrderPlaced;
use App\Listeners\SendReceipt;
use App\Listeners\UpdateStock;

class EventServiceProvider
{
    protected $listen = [
        OrderPlaced::class => [
            SendReceipt::class,
            UpdateStock::class,
        ],
    ];
}
