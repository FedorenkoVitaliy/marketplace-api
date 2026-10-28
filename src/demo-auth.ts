/**
 * ДЗ#24 demo:auth — login → захищений ресурс → refresh → logout.
 * Logout мусить вбити і access (денилист jti), і refresh (сімʼя).
 */
import { runDemo } from './auth/demo-kit.js';

const BUYER = 'buyer@shop.test';

const expected = {
  login: 200,
  'no-token': 401,
  'with-token': 200,
  refresh: 200,
  logout: 204,
  'after-logout': 401,
  'refresh-after-logout': 401,
};

runDemo(3291, expected, async (kit) => {
  const orderId = await kit.orderOf(BUYER);
  const order = `/orders/${orderId}`;

  const login = await kit.login(BUYER);
  const noToken = await kit.call('GET', order);
  const withToken = await kit.call('GET', order, { token: login.accessToken });
  const refreshed = await kit.refresh(login.refreshToken);
  const logout = await kit.call('POST', '/auth/logout', { token: refreshed.accessToken });
  const afterLogout = await kit.call('GET', order, { token: refreshed.accessToken });
  const refreshAfterLogout = await kit.refresh(refreshed.refreshToken);

  return {
    login: login.status,
    'no-token': noToken.status,
    'with-token': withToken.status,
    refresh: refreshed.status,
    logout: logout.status,
    'after-logout': afterLogout.status,
    'refresh-after-logout': refreshAfterLogout.status,
  };
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
