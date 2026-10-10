import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { anOrder, aUser } from './builders.js';
import { OrdersRepo } from './orders.repo.js';
import { startPg } from './pg.js';
import { UsersRepo } from './users.repo.js';

describe('OrdersRepo', () => {
  let pg: Awaited<ReturnType<typeof startPg>>;
  let users: UsersRepo;
  let orders: OrdersRepo;

  beforeAll(async () => {
    pg = await startPg();
    users = new UsersRepo(pg.pool);
    orders = new OrdersRepo(pg.pool);
  });

  beforeEach(async () => {
    await pg.reset();
  });

  afterAll(async () => {
    await pg.stop();
  });

  it('зберігає замовлення покупця', async () => {
    const user = await users.insert(aUser());
    const saved = await orders.insert(anOrder(user.id));
    const found = await orders.findById(saved.id);
    expect(found).toEqual({ id: saved.id, status: 'pending' });
  });

  it('чужий user_id впирається в foreign key і повертає 23503', async () => {
    await expect(orders.insert(anOrder('999999'))).rejects.toMatchObject({ code: '23503' });
  });

  it('JOIN з users повертає email покупця', async () => {
    const draft = aUser();
    const user = await users.insert(draft);
    const saved = await orders.insert(anOrder(user.id, { status: 'completed' }));
    const row = await orders.findWithBuyer(saved.id);
    expect(row).toEqual({ id: saved.id, email: draft.email });
  });
});
