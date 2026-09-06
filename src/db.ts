import { readFile } from 'node:fs/promises'
import pg from 'pg'

export function createPool(connectionString: string) {
    const pool = new pg.Pool({
        connectionString: connectionString,
        password: async () => {
            const pass = await readFile(new URL("../../secrets/db_password", import.meta.url), 'utf8');
            return pass.trim();
        },
        max: 3,
    })
    pool.on('error', () => console.log('error'))
    return pool
}