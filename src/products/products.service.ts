import { Injectable, NotFoundException } from '@nestjs/common';
import { getCurrentCursor, getNextCursor } from '../cursor.js';

@Injectable()
export class ProductsService {
    private readonly products = [{ id: 1 }, { id: 2 }];

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
