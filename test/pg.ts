import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';

export async function startPg() {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const dataSource = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    synchronize: false,
    entities: ['dist/src/entities/*.js'],
    migrations: ['dist/src/migrations/*.js'],
  });
  await dataSource.initialize();
  await dataSource.runMigrations();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  return {
    pool,
    async stop() {
      await pool.end();
      await dataSource.destroy();
      await container.stop();
    },
  };
}
