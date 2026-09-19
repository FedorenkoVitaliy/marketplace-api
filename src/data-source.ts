import 'reflect-metadata'
import { AbstractLogger, DataSource, type LogLevel, type LogMessage } from 'typeorm'

export class QueryCountLogger extends AbstractLogger {
    count = 0
    protected writeLog(_level: LogLevel, messages: LogMessage | LogMessage[]) {
        for (const m of Array.isArray(messages) ? messages : [messages]) {
            if (m.type === 'query') this.count += 1
        }
    }
    reset() {
        this.count = 0
    }
}

export const logger = new QueryCountLogger(['query'])

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
    logger,
  });
