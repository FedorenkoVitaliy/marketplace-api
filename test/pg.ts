import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

export async function startPg() {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  await pool.query(`
    CREATE TABLE orders (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      total_cents int NOT NULL
    )
  `);
  return {
    pool,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
