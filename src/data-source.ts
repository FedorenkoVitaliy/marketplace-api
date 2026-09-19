import 'reflect-metadata'
import { DataSource } from 'typeorm'

export default new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),
    synchronize: false,
    entities: ['dist/src/entities/*.js'],
    migrations: ['dist/src/migrations/*.js'],
  });