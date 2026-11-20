import http from 'node:http';
import { createWriteStream } from 'node:fs';

const url = new URL(process.argv[2]);
const duration = Number(process.argv[3]);
const workers = Number(process.argv[4]);
const out = process.argv[5];
const rps = Number(process.argv[6] ?? 0);
const agent = new http.Agent({ keepAlive: false });
const stream = createWriteStream(out);
const end = Date.now() + duration * 1000;

function once() {
  return new Promise((resolve) => {
    const req = http.get(url, { agent, timeout: 2000 }, (res) => {
      res.resume();
      const code = res.statusCode ?? 0;
      res.on('end', () => resolve(code));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
  });
}

await Promise.all(Array.from({ length: workers }, async () => {
  while (Date.now() < end) {
    const started = Date.now();
    const code = await once();
    stream.write(`${String(code).padStart(3, '0')}\n`);
    if (rps > 0) {
      const wait = Math.round(1000 / (rps / workers)) - (Date.now() - started);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}));
await new Promise((resolve) => stream.end(resolve));
