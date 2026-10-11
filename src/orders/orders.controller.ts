import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OrderEventsService } from './order-events.service.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
  ) {}

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    return this.orders.list(limit, cursor);
  }

  // SSE-потік змін статусу. Стоїть вище за ':id', щоб шлях не зʼїв параметр.
  @Get(':id/events')
  streamEvents(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Довге HTTP-зʼєднання: клієнт (EventSource) читає події, поки тримає сокет.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // Темп авто-реконекту браузера (~1с). Без цього дефолт довгий і демо «висить».
    res.write('retry: 1000\n\n');

    // Реконект: клієнт шле Last-Event-ID — віддаємо з буфера все новіше, без дублікатів.
    const lastEventId = Number(req.headers['last-event-id'] ?? 0);
    for (const event of this.events.since(id, lastEventId)) {
      this.writeSse(res, event.eventId, event.status);
    }

    // Далі — живі події з шини; чужі замовлення ігноруємо.
    const sub = this.events.stream().subscribe((event) => {
      if (event.orderId !== id) return;
      this.writeSse(res, event.eventId, event.status);
    });

    // Клієнт закрив вкладку / обірвався — відписатись, інакше витік підписки.
    req.on('close', () => sub.unsubscribe());
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.orders.findById(Number(id));
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: { items: number[] }) {
    return this.orders.create(body.items);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.orders.updateStatus(Number(id), body.status);
  }

  // Формат SSE: id / event / data + порожній рядок-роздільник кадрів.
  private writeSse(res: Response, eventId: number, status: string) {
    res.write(`id: ${eventId}\n`);
    res.write(`event: order.status\n`);
    res.write(`data: ${JSON.stringify({ status })}\n\n`);
  }
}
