import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import { Job } from '../../src/entities/job.entity.js';
import { OrderItem } from '../../src/entities/order-item.entity.js';
import { Order } from '../../src/entities/order.entity.js';
import { Product } from '../../src/entities/product.entity.js';
import { User } from '../../src/entities/user.entity.js';
import { AddJobs1790116349422 } from '../../src/migrations/1790116349422-AddJobs.js';
import { AddProductStock1790032272412 } from '../../src/migrations/1790032272412-AddProductStock.js';
import { AddUserBalance1790407200000 } from '../../src/migrations/1790407200000-AddUserBalance.js';
import { InitSchema1789821128278 } from '../../src/migrations/1789821128278-InitSchema.js';

export async function startPg() {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const uri = container.getConnectionUri();
  const dataSource = new DataSource({
    type: 'postgres',
    host: container.getHost(),
    port: container.getPort(),
    username: container.getUsername(),
    password: container.getPassword(),
    database: container.getDatabase(),
    synchronize: false,
    entities: [User, Product, Order, OrderItem, Job],
    migrations: [
      InitSchema1789821128278,
      AddProductStock1790032272412,
      AddJobs1790116349422,
      AddUserBalance1790407200000,
    ],
  });
  await dataSource.initialize();
  await dataSource.runMigrations();
  const pool = new Pool({ connectionString: uri });
  return {
    uri,
    pool,
    async reset() {
      await pool.query(
        'TRUNCATE order_items, orders, products, jobs, users RESTART IDENTITY CASCADE',
      );
    },
    async stop() {
      await pool.end();
      await dataSource.destroy();
      await container.stop();
    },
  };
}
