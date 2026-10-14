/** Topic exchange домену Marketplace — продюсер шле сюди, не в чергу. */
export const EXCHANGE = 'shop.events';
export const ROUTING_KEY = 'order.placed';

/** Робоча черга під order.placed (оголошує споживач / бутстрап). */
export const QUEUE = 'shop.orders.placed';

/** Dead-letter exchange + черга — окремий контур отруєних повідомлень. */
export const DLX = 'shop.dlx';
export const DLQ = 'shop.orders.placed.dlq';

/**
 * Скільки unacked повідомлень брокер віддає одному споживачу.
 * 10 × ~50 мс обробки ≪ 30 хв consumer_timeout (стоковий таймаут RabbitMQ).
 */
export const PREFETCH = 10;

export const QUORUM = { 'x-queue-type': 'quorum' } as const;
