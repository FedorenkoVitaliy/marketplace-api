import { EXCHANGE, ROUTING_KEY } from './constants.js';
import { body, withConfirmChannel } from './amqp.js';
import { buildOrderPlaced, type OrderPlacedEvent } from './events.js';

/** Публікація в exchange (не в чергу). Топологію має вже оголосити бутстрап/споживач. */
export async function publishOrderPlaced(input: {
  orderId: string | number;
  userId: string | number;
  totalCents: number;
}): Promise<OrderPlacedEvent> {
  const event = buildOrderPlaced(input);
  await withConfirmChannel(async (ch) => {
    const ok = ch.publish(EXCHANGE, ROUTING_KEY, body(event), {
      persistent: true,
      contentType: 'application/json',
      messageId: event.eventId,
      type: event.type,
      mandatory: true,
    });
    if (!ok) throw new Error('publish buffer full');
    await ch.waitForConfirms();
  });
  return event;
}

/** Для HTTP-шляху: якщо брокера в env немає (тести) — пропускаємо. */
export async function publishOrderPlacedIfConfigured(input: {
  orderId: string | number;
  userId: string | number;
  totalCents: number;
}): Promise<void> {
  if (!process.env.BROKER_URL && !process.env.AMQP_URL) return;
  await publishOrderPlaced(input);
}
