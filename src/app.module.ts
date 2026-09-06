import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OrdersModule } from './orders/orders.module.js';
import { ProblemFilter } from './problem.filter.js';
import { ProductsModule } from './products/products.module.js';
import { validate } from './config/env.schema.js';
import { createPool } from './db.js';
import { HealthController } from './health.controller.js';

@Module({
    controllers: [HealthController],
    imports: [
      ProductsModule, 
      OrdersModule, 
      ConfigModule.forRoot({
        validate,
        envFilePath: '.env',
        isGlobal: true,
      })
    ],
    providers: [
      { 
        provide: APP_FILTER, 
        useClass: ProblemFilter 
      },
      {
        provide: 'PG_POOL',
        inject: [ConfigService],
        useFactory: (config) => createPool(config.get('DB_URL', { infer: true })),
      }
    ],
})
export class AppModule {}
