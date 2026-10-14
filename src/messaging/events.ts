export type OrderPlacedEvent = {
  eventId: string;
  type: 'order.placed';
  occurredAt: string;
  data: {
    orderId: string;
    userId: string;
    totalCents: number;
  };
};

/** Стабільний ключ дедупа — не випадковий UUID на кожну спробу publish. */
export function orderPlacedEventId(orderId: string | number): string {
  return `order.placed:${orderId}`;
}

export function buildOrderPlaced(input: {
  orderId: string | number;
  userId: string | number;
  totalCents: number;
  occurredAt?: Date;
}): OrderPlacedEvent {
  return {
    eventId: orderPlacedEventId(input.orderId),
    type: 'order.placed',
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    data: {
      orderId: String(input.orderId),
      userId: String(input.userId),
      totalCents: input.totalCents,
    },
  };
}
