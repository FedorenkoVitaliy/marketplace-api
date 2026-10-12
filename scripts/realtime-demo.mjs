import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const sameRoom = process.argv.includes('--same-room');

async function createOrder(key) {
  const res = await fetch(`${BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({ items: [1] }),
  });
  if (!res.ok) {
    throw new Error(`POST /orders → ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function connectAndJoin(orderId, userId) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, {
      auth: { userId: String(userId) },
      transports: ['websocket'],
    });
    const state = { received: 0, socket };

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`join timeout order=${orderId}`));
    }, 8000);

    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    socket.on('order.status', () => {
      state.received = 1;
    });

    socket.on('connect', () => {
      socket.emit('join', { orderId: String(orderId) }, (ack) => {
        clearTimeout(timer);
        if (!ack?.ok) {
          socket.close();
          reject(new Error(`join refused: ${ack?.error ?? 'unknown'}`));
          return;
        }
        resolve(state);
      });
    });
  });
}

async function main() {
  const stamp = Date.now();
  const orderA = await createOrder(`hw18-a-${stamp}`);
  const orderB = await createOrder(`hw18-b-${stamp}`);
  const userId = orderA.user_id;
  if (userId == null) {
    throw new Error('create response missing user_id');
  }

  const roomB = sameRoom ? orderA.id : orderB.id;
  const expectB = sameRoom ? 1 : 0;

  const clientA = await connectAndJoin(orderA.id, userId);
  const clientB = await connectAndJoin(roomB, userId);

  const patch = await fetch(`${BASE}/orders/${orderA.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  });
  if (!patch.ok) {
    throw new Error(`PATCH status → ${patch.status} ${await patch.text()}`);
  }

  await new Promise((r) => setTimeout(r, 400));

  console.log(`A_RECEIVED=${clientA.received}`);
  console.log(`B_RECEIVED=${clientB.received}`);

  clientA.socket.close();
  clientB.socket.close();

  const ok = clientA.received === 1 && clientB.received === expectB;
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
