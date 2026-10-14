import { Injectable } from '@nestjs/common';
import { Subject, type Observable } from 'rxjs';

export type OrderStatusEvent = {
  orderId: string;
  status: string;
  eventId: number;
};

const BUFFER_LIMIT = 32;

@Injectable()
export class OrderEventsService {
  private readonly bus = new Subject<OrderStatusEvent>();
  private readonly buffers = new Map<string, OrderStatusEvent[]>();
  private nextId = 1;

  stream(): Observable<OrderStatusEvent> {
    return this.bus.asObservable();
  }

  publish(orderId: string, status: string): OrderStatusEvent {
    const event = { orderId, status, eventId: this.nextId++ };

    let list = this.buffers.get(orderId);
    if (!list) {
      list = [];
      this.buffers.set(orderId, list);
    }
    list.push(event);

    if (list.length > BUFFER_LIMIT) {
      list.splice(0, list.length - BUFFER_LIMIT);
    }

    this.bus.next(event);

    return event;
  }

  since(orderId: string, afterEventId: number): OrderStatusEvent[] {
    const list = this.buffers.get(orderId) ?? [];
    return list.filter((event) => event.eventId > afterEventId);
  }
}
