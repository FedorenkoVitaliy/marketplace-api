import http from 'node:http';

const port = Number(process.env.PORT ?? 8080);
const warmupMs = Number(process.env.WARMUP_MS ?? 4000);
const drainMs = Number(process.env.DRAIN_MS ?? 8000);

if (!process.env.APP_DB_PASSWORD) {
  console.error('APP_DB_PASSWORD is required');
  process.exit(1);
}

let ready = false;
let closing = false;
let listening = false;

const server = http.createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ alive: true }));
    return;
  }
  if (path === '/readyz') {
    if (!ready || closing) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ready: false }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ready: true }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok');
});

function shutdown() {
  if (closing) return;
  closing = true;
  ready = false;
  setTimeout(() => {
    if (!listening) {
      process.exit(0);
      return;
    }
    server.close(() => process.exit(0));
  }, drainMs);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

setTimeout(() => {
  server.listen(port, '0.0.0.0', () => {
    listening = true;
    ready = true;
  });
}, warmupMs);
