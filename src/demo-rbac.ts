/**
 * ДЗ#24 demo:rbac — 401 (хто ти?) ≠ 403 (тобі не можна).
 * Власність замовлення — у сервісі; роль на запис товару — RolesGuard.
 * tampered: payload з role=admin під СТАРИМ підписом → 401.
 */
import { runDemo } from './auth/demo-kit.js';

const BUYER = 'buyer@shop.test';
const SELLER = 'seller@shop.test';
const PRODUCT = { name: 'RBAC demo product', price: 1000, stock: 1 };

const expected = {
  anon: 401,
  own: 200,
  foreign: 403,
  'role-denied': 403,
  'role-allowed': 201,
  tampered: 401,
};

function withRole(token: string, role: string): string {
  const [header, payload, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
  return [header, Buffer.from(JSON.stringify({ ...claims, role })).toString('base64url'), signature].join('.');
}

runDemo(3293, expected, async (kit) => {
  const ownOrder = await kit.orderOf(BUYER);
  const foreignOrder = await kit.orderOf(SELLER);
  const buyer = await kit.login(BUYER);
  const seller = await kit.login(SELLER);

  const anon = await kit.call('GET', `/orders/${ownOrder}`);
  const own = await kit.call('GET', `/orders/${ownOrder}`, { token: buyer.accessToken });
  const foreign = await kit.call('GET', `/orders/${foreignOrder}`, { token: buyer.accessToken });
  const roleDenied = await kit.call('POST', '/products', { token: buyer.accessToken, body: PRODUCT });
  const roleAllowed = await kit.call('POST', '/products', { token: seller.accessToken, body: PRODUCT });
  if (roleAllowed.body?.id) kit.trackProduct(Number(roleAllowed.body.id));
  const tampered = await kit.call('POST', '/products', {
    token: withRole(buyer.accessToken, 'admin'),
    body: PRODUCT,
  });
  if (tampered.body?.id) kit.trackProduct(Number(tampered.body.id));

  return {
    anon: anon.status,
    own: own.status,
    foreign: foreign.status,
    'role-denied': roleDenied.status,
    'role-allowed': roleAllowed.status,
    tampered: tampered.status,
  };
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
