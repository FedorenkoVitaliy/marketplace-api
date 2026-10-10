import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { OrdersModule } from './orders/orders.module.js';
import { ProblemFilter } from './problem.filter.js';
import { ProductsModule } from './products/products.module.js';
import { validate } from './config/env.schema.js';
import { DbModule } from './db.module.js';
import { HealthController } from './health.controller.js';

@Module({
    controllers: [HealthController],
    imports: [
      ConfigModule.forRoot({
        validate,
        envFilePath: '.env',
        isGlobal: true,
      }),
      DbModule,
      ProductsModule,
      OrdersModule,
    ],
    providers: [
      {
        provide: APP_FILTER,
        useClass: ProblemFilter,
      },
    ],
})
export class AppModule {}
