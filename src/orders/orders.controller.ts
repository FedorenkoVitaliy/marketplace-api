import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
    constructor(private readonly orders: OrdersService) {}

    @Get()
    list(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
        return this.orders.list(limit, cursor);
    }

    @Get(':id')
    getById(@Param('id') id: string) {
        return this.orders.findById(Number(id));
    }

    @Post()
    @HttpCode(201)
    create() {
        return this.orders.create();
    }
}
