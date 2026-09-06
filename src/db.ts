import { readFile } from 'node:fs/promises'
import pg from 'pg'

export function createPool(connectionString: string) {
    const url = new URL(connectionString)
    const pool = new pg.Pool({
        host: url.hostname,
        port: Number(url.port) || 5432,
        user: decodeURIComponent(url.username),
        database: url.pathname.replace(/^\//, ''),
        password: async () => {
            const pass = await readFile(new URL('../../secrets/db_password', import.meta.url), 'utf8')
            return pass.trim()
        },
        max: 3,
    })
    pool.on('error', () => console.log('error'))
    return pool
}