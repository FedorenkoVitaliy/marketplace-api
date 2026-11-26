import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg'

@Controller()
export class HealthController {
    constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

    @Get('health')
    ping() {
        return { uptime: process.uptime() };
    }

    /** Процес живий. Базу не чіпає: мертвий Postgres не має валити liveness. */
    @Get('healthz')
    live() {
        return { alive: true };
    }

    /** Готовий приймати трафік: є з'єднання з Postgres. */
    @Get('readyz')
    async ready() {
        try {
            await this.pool.query('SELECT 1');
        } catch {
            throw new ServiceUnavailableException('database');
        }
        return { ready: true };
    }

    @Get('db')
    async pingDb() {
        const result = await this.pool.query('SELECT 1');
        return result.rows;
    }
}
