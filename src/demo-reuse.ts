/**
 * ДЗ#24 demo:reuse — повторний refresh використаного R1 валить усю сімʼю:
 * після цього і «живий» R2 отримує 401 (RFC 9700 §4.14.2).
 */
import { runDemo } from './auth/demo-kit.js';

const expected = {
  login: 200,
  'r1-refresh': 200,
  'r1-reuse': 401,
  'r2-after-reuse': 401,
};

runDemo(3292, expected, async (kit) => {
  const login = await kit.login('buyer@shop.test');
  const r1Refresh = await kit.refresh(login.refreshToken);
  const r1Reuse = await kit.refresh(login.refreshToken);
  const r2AfterReuse = await kit.refresh(r1Refresh.refreshToken);

  return {
    login: login.status,
    'r1-refresh': r1Refresh.status,
    'r1-reuse': r1Reuse.status,
    'r2-after-reuse': r2AfterReuse.status,
  };
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
