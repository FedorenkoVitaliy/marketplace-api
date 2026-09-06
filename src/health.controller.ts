import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'pg'

@Controller()
export class HealthController {
    constructor(@Inject('PG_POOL') private readonly pool: Pool) {}
    @Get('health')
    ping() {
        return { uptime: process.uptime() };
    }
    @Get('db')
    async pingDb() {
    const result = await this.pool.query('SELECT 1');
    return result.rows;
    }
}
