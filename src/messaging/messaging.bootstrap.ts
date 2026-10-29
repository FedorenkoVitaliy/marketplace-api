import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';
import { withChannel } from './amqp.js';
import { relayPass } from './outbox.js';
import { assertTopology } from './topology.js';

@Injectable()
export class MessagingBootstrap implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MessagingBootstrap.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;

  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async onModuleInit() {
    if (!process.env.BROKER_URL && !process.env.AMQP_URL) {
      this.log.warn('BROKER_URL відсутній — messaging bootstrap пропущено');
      return;
    }
    await withChannel(async (ch) => {
      await assertTopology(ch);
    });
    this.log.log('RabbitMQ topology ready');

    // Polling publisher: outbox → broker (SKIP LOCKED всередині relayPass)
    this.timer = setInterval(() => {
      void this.tick();
    }, Number(process.env.OUTBOX_POLL_MS ?? 500));
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const n = await relayPass(this.pool, { crashBeforeUpdate: false, limit: 50 });
      if (n > 0) this.log.debug(`outbox relay published ${n}`);
    } catch (e) {
      this.log.warn(`outbox relay: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.busy = false;
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
