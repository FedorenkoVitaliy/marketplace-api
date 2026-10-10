import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import { type Env } from './config/env.schema.js';
import { createPool } from './db.js';

@Global()
@Module({
  providers: [
    {
      provide: 'PG_POOL',
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createPool(process.env.DATABASE_URL ?? config.get('DB_URL', { infer: true })),
    },
  ],
  exports: ['PG_POOL'],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}
