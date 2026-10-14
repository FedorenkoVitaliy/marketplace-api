import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { withChannel } from './amqp.js';
import { assertTopology } from './topology.js';

@Injectable()
export class MessagingBootstrap implements OnModuleInit {
  private readonly log = new Logger(MessagingBootstrap.name);

  async onModuleInit() {
    if (!process.env.BROKER_URL && !process.env.AMQP_URL) {
      this.log.warn('BROKER_URL відсутній — messaging bootstrap пропущено');
      return;
    }
    await withChannel(async (ch) => {
      await assertTopology(ch);
    });
    this.log.log('RabbitMQ topology ready');
  }
}
