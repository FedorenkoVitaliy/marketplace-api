import 'reflect-metadata';
import { Verifier } from '@pact-foundation/pact';
import { startPg } from './pg.js';

const broker = process.env.PACT_BROKER_URL ?? 'http://127.0.0.1:21620';
const token = process.env.PACT_BROKER_TOKEN;

const pg = await startPg();
process.env.PORT = '3218';
process.env.DB_URL = pg.uri;
process.env.LOG_LEVEL = 'error';

const { createHttpApp } = await import('../src/main.js');
const http = await createHttpApp();
await http.listen(0);

try {
  await new Verifier({
    provider: 'marketplace-api',
    providerBaseUrl: http.url(),
    pactBrokerUrl: broker,
    ...(token ? { pactBrokerToken: token } : {}),
    publishVerificationResult: true,
    providerVersion: process.env.GIT_COMMIT ?? '1.0.0',
    providerVersionBranch: 'hw-16',
    consumerVersionSelectors: [{ latest: true }],
    logLevel: 'warn',
  }).verifyProvider();
} finally {
  await http.close();
  await pg.stop();
}
