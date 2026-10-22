import { Controller, Headers, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PaymentsService } from './payments.service.js';

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('orders/:id/pay')
  pay(@Param('id') id: string) {
    return this.payments.createIntent(id);
  }

  /**
   * Сире тіло (express.raw на /webhooks) — HMAC рахується над байтами.
   */
  @Post('webhooks/stub')
  async webhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const raw = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(
          typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}),
        );
    const result = await this.payments.handleWebhook(raw, {
      'x-stub-signature': headers['x-stub-signature'],
    });
    res.status(result.httpStatus).json(result);
  }
}
