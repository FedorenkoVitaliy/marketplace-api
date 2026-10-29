import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PAYMENT_PROVIDER } from './port.js';
import { StubProvider } from './stub-provider.js';

@Module({
  controllers: [PaymentsController],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      useFactory: () =>
        new StubProvider(process.env.PAYMENT_WEBHOOK_SECRET ?? 'stub-dev-secret'),
    },
    PaymentsService,
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
