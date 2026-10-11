import { Module } from '@nestjs/common';
import { OrderEventsService } from './order-events.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';

@Module({
    controllers: [OrdersController],
    providers: [OrdersService, OrderEventsService],
    exports: [OrderEventsService],
})
export class OrdersModule {}
