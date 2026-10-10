import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, it } from '@jest/globals';
import { Verifier } from '@pact-foundation/pact';
import { Pool } from 'pg';
import { createHttpApp } from '../../src/main.js';
import { startPg } from '../integration/pg.js';
import { seedCatalog } from '../integration/seed-catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pactFile = path.join(root, 'pacts', 'marketplace-web-marketplace-api.json');
const providerVersion = '1.0.0';

describe('verify marketplace-api', () => {
  let pg: Awaited<ReturnType<typeof startPg>>;
  let http: Awaited<ReturnType<typeof createHttpApp>>;

  beforeAll(async () => {
    pg = await startPg();
    process.env.DATABASE_URL = pg.uri;
    process.env.DB_URL = pg.uri;
    process.env.PORT = '3217';
    process.env.LOG_LEVEL = 'error';
    http = await createHttpApp();
    await http.listen(0);
  });

  afterAll(async () => {
    await http.close();
    await pg.stop();
  });

  it('відповідає на контракт', async () => {
    const broker = process.env.PACT_BROKER_URL;
    const token = process.env.PACT_BROKER_TOKEN;
    const seed = new Pool({ connectionString: pg.uri });
    try {
      await new Verifier({
        provider: 'marketplace-api',
        providerBaseUrl: http.url(),
        logLevel: 'warn',
        stateHandlers: {
          'buyer exists': async () => {
            await seedCatalog(seed, {
              buyerEmail: 'pact-buyer@example.com',
              sellerEmail: 'seller@shop.test',
            });
          },
        },
        ...(broker
          ? {
              pactBrokerUrl: broker,
              ...(token ? { pactBrokerToken: token } : {}),
              publishVerificationResult: true,
              providerVersion,
              providerVersionBranch: 'hw-16',
              consumerVersionSelectors: [{ latest: true }],
            }
          : { pactUrls: [pactFile] }),
      }).verifyProvider();
    } finally {
      await seed.end();
    }
  });
});
