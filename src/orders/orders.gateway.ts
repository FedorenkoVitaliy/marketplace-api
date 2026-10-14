import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { OrderEventsService } from './order-events.service.js';
import { OrdersService } from './orders.service.js';

@WebSocketGateway({ cors: { origin: true } })
export class OrdersGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private sub?: Subscription;

  constructor(
    private readonly events: OrderEventsService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit() {
    this.sub = this.events.stream().subscribe((event) => {
      this.server
        .to(`orders:${event.orderId}`)
        .emit('order.status', {
          orderId: event.orderId,
          status: event.status,
          eventId: event.eventId,
        });
    });
  }

  onModuleDestroy() {
    this.sub?.unsubscribe();
  }

  @SubscribeMessage('join')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { orderId: string },
  ): Promise<{ ok: true; room: string } | { ok: false; error: string }> {
    const userId = String(
      client.handshake.auth?.userId ?? client.handshake.query?.userId ?? '',
    );
    if (!userId) {
      return { ok: false, error: 'anonymous' };
    }

    const orderId = String(body?.orderId ?? '');
    if (!orderId) {
      return { ok: false, error: 'orderId required' };
    }

    const owned = await this.orders.isOwnedBy(Number(orderId), userId);
    if (!owned) {
      return { ok: false, error: 'forbidden' };
    }

    const room = `orders:${orderId}`;
    await client.join(room);
    return { ok: true, room };
  }
}
