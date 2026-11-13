import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { runWithRequest } from '../observability/context.js';
import { layerLogger, logger } from '../observability/logger.js';
import { OrderEventsService } from './order-events.service.js';
import { OrdersService } from './orders.service.js';

const controllerLog = layerLogger(logger, 'orders.controller');

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

  @Get(':id/events')
  async streamEvents(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = String(
      req.headers['x-user-id'] ?? req.query.userId ?? '',
    );
    if (!userId) {
      throw new UnauthorizedException('anonymous');
    }
    const owned = await this.orders.isOwnedBy(Number(id), userId);
    if (!owned) {
      throw new ForbiddenException('forbidden');
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');

    const lastEventId = Number(req.headers['last-event-id'] ?? 0);
    for (const event of this.events.since(id, lastEventId)) {
      this.writeSse(res, event.eventId, event.status);
    }

    const sub = this.events.stream().subscribe((event) => {
      if (event.orderId !== id) return;
      this.writeSse(res, event.eventId, event.status);
    });

    req.on('close', () => sub.unsubscribe());
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  getById(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    controllerLog.info({ id }, 'get order');
    return runWithRequest({ userId: user.id }, () => this.orders.findOwned(Number(id), user));
  }

  @Post()
  @HttpCode(201)
  create(
    @Body() body: { items: number[] },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    controllerLog.info('create order');
    return runWithRequest({ idempotencyKey }, () => this.orders.create(body.items, idempotencyKey));
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.orders.updateStatus(Number(id), body.status);
  }

  private writeSse(res: Response, eventId: number, status: string) {
    res.write(`id: ${eventId}\n`);
    res.write(`event: order.status\n`);
    res.write(`data: ${JSON.stringify({ status })}\n\n`);
  }
}
