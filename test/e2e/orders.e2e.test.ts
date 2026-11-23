import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import request from 'supertest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { hashPassword } from '../../src/auth/password.js';
import { mountHttp } from '../../src/main.js';
import { useTestJwtEnv } from '../integration/jwt-env.js';
import { startPg } from '../integration/pg.js';
import { seedCatalog } from '../integration/seed-catalog.js';

const buyerEmail = 'buyer@e2e.test';
const buyerPassword = 'e2e-buyer-pass';

describe('POST /orders', () => {
  let pg: Awaited<ReturnType<typeof startPg>>;
  let redis: StartedTestContainer;
  let http: express.Express;
  let close: () => Promise<void>;
  let accessToken: string;

  beforeAll(async () => {
    pg = await startPg();
    redis = await new GenericContainer('redis:8-alpine').withExposedPorts(6379).start();
    process.env.REDIS_QUEUE_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    process.env.DATABASE_URL = pg.uri;
    process.env.DB_URL = pg.uri;
    process.env.PORT = '3216';
    process.env.LOG_LEVEL = 'error';
    useTestJwtEnv();
    await seedCatalog(pg.pool, { buyerEmail, sellerEmail: 'seller@e2e.test' });
    await pg.pool.query(
      `UPDATE users SET role = 'buyer', password_hash = $1 WHERE email = $2`,
      [await hashPassword(buyerPassword), buyerEmail],
    );

    http = express();
    mountHttp(http);
    // ConfigModule.forRoot({ validate }) — на імпорті AppModule; env уже виставлено вище.
    const { AppModule } = await import('../../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication(new ExpressAdapter(http), { bodyParser: false });
    await app.init();
    close = () => app.close();

    const login = await request(http)
      .post('/auth/login')
      .send({ email: buyerEmail, password: buyerPassword })
      .expect(200);
    accessToken = login.body.accessToken;
  });

  afterAll(async () => {
    if (close) await close();
    if (redis) await redis.stop();
    if (pg) await pg.stop();
  });

  it('створює замовлення і віддає його за id', async () => {
    const created = await request(http)
      .post('/orders')
      .set('Idempotency-Key', 'hw16-happy')
      .send({ items: [1] })
      .expect(201);

    expect(created.body).toMatchObject({ id: expect.any(Number), total_cents: expect.any(Number) });

    await request(http).get(`/orders/${created.body.id}`).expect(401);

    const fetched = await request(http)
      .get(`/orders/${created.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(fetched.body).toEqual(created.body);
  });

  it('невідомий id відповідає 404', async () => {
    await request(http)
      .get('/orders/999999')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });
});
