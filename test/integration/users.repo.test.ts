import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { aUser } from './builders.js';
import { startPg } from './pg.js';
import { UsersRepo } from './users.repo.js';

describe('UsersRepo', () => {
  let pg: Awaited<ReturnType<typeof startPg>>;
  let users: UsersRepo;

  beforeAll(async () => {
    pg = await startPg();
    users = new UsersRepo(pg.pool);
  });

  beforeEach(async () => {
    await pg.reset();
  });

  afterAll(async () => {
    await pg.stop();
  });

  it('зберігає користувача і знаходить його за email', async () => {
    const draft = aUser();
    const saved = await users.insert(draft);
    const found = await users.findByEmail(draft.email);
    expect(found).toEqual({ id: saved.id, email: draft.email });
  });

  it('повторний email впирається в unique і повертає 23505', async () => {
    const draft = aUser();
    await users.insert(draft);
    await expect(users.insert(draft)).rejects.toMatchObject({ code: '23505' });
  });

  it('ON CONFLICT DO NOTHING лишає один рядок', async () => {
    const draft = aUser();
    const first = await users.insertOrIgnore(draft);
    const second = await users.insertOrIgnore(draft);
    expect(second).toEqual(first);
  });
});
