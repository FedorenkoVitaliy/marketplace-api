import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { getCurrentCursor, getNextCursor } from '../cursor.js';

export type CreateProduct = { name: string; price: number; stock?: number };

@Injectable()
export class ProductsService {
    private readonly products = [{ id: 1 }, { id: 2 }];

    constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

    async create(sellerId: string, body: CreateProduct) {
        const { rows } = await this.pool.query<{ id: number }>(
            `INSERT INTO products (name, description, price, stock, seller_id)
             VALUES ($1, '', $2, $3, $4)
             RETURNING id::int`,
            [body.name, body.price, body.stock ?? 0, sellerId],
        );
        return rows[0]!;
    }

    list(limit?: string, cursor?: string) {
        const parsedLimit = Number(limit) || this.products.length;
        const start = getCurrentCursor(cursor);
        const end = start + parsedLimit;
        return {
            items: this.products.slice(start, end),
            next_cursor: getNextCursor(end, this.products.length),
        };
    }

    findById(id: number) {
        const product = this.products.find((p) => p.id === id);
        if (!product) {
            throw new NotFoundException('Product not found');
        }
        return product;
    }
}
