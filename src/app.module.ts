import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { OrdersModule } from './orders/orders.module.js';
import { ProblemFilter } from './problem.filter.js';
import { ProductsModule } from './products/products.module.js';

@Module({
    imports: [ProductsModule, OrdersModule],
    providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
})
export class AppModule {}
