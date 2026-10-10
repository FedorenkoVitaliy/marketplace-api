import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { mountHttp } from '../../src/main.js';
import { startPg } from '../integration/pg.js';
import { seedCatalog } from '../integration/seed-catalog.js';

describe('POST /orders', () => {
  let pg: Awaited<ReturnType<typeof startPg>>;
  let http: express.Express;
  let close: () => Promise<void>;

  beforeAll(async () => {
    pg = await startPg();
    process.env.DATABASE_URL = pg.uri;
    process.env.DB_URL = pg.uri;
    process.env.PORT = '3216';
    process.env.LOG_LEVEL = 'error';
    await seedCatalog(pg.pool, { buyerEmail: 'buyer@e2e.test', sellerEmail: 'seller@e2e.test' });

    http = express();
    mountHttp(http);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication(new ExpressAdapter(http), { bodyParser: false });
    await app.init();
    close = () => app.close();
  });

  afterAll(async () => {
    await close();
    await pg.stop();
  });

  it('створює замовлення і віддає його за id', async () => {
    const created = await request(http)
      .post('/orders')
      .set('Idempotency-Key', 'hw16-happy')
      .send({ items: [1] })
      .expect(201);

    expect(created.body).toMatchObject({ id: expect.any(Number), total_cents: expect.any(Number) });

    const fetched = await request(http)
      .get(`/orders/${created.body.id}`)
      .expect(200);

    expect(fetched.body).toEqual(created.body);
  });

  it('невідомий id відповідає 404', async () => {
    await request(http).get('/orders/999999').expect(404);
  });
});
