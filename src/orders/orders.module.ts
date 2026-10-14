import { Module } from '@nestjs/common';
import { MessagingBootstrap } from '../messaging/messaging.bootstrap.js';
import { OrderEventsService } from './order-events.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersGateway } from './orders.gateway.js';
import { OrdersService } from './orders.service.js';

@Module({
    controllers: [OrdersController],
    providers: [OrdersService, OrderEventsService, OrdersGateway, MessagingBootstrap],
    exports: [OrderEventsService],
})
export class OrdersModule {}
