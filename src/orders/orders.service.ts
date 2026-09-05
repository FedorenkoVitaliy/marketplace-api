import { Injectable, NotFoundException } from '@nestjs/common';
import { getCurrentCursor, getNextCursor } from '../cursor.js';

@Injectable()
export class OrdersService {
    private readonly orders: { id: number; total_cents: number }[] = [];

    list(limit?: string, cursor?: string) {
        const parsedLimit = Number(limit) || this.orders.length;
        const start = getCurrentCursor(cursor);
        const end = start + parsedLimit;
        return {
            items: this.orders.slice(start, end),
            next_cursor: getNextCursor(end, this.orders.length),
        };
    }

    findById(id: number) {
        const order = this.orders.find((o) => o.id === id);
        if (!order) {
            throw new NotFoundException('Order not found');
        }
        return order;
    }

    create() {
        const order = { id: this.orders.length + 1, total_cents: 0 };
        this.orders.push(order);
        return order;
    }
}
