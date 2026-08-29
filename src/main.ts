import { readFileSync } from 'node:fs';
import express, { type ErrorRequestHandler, type Request } from 'express';
import { middleware } from 'express-openapi-validator';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';

type QueryValue = Request['query'][string];

const getCurrentCursor = (cursor: QueryValue) => {
    return typeof cursor === 'string'
        ? Number(Buffer.from(cursor, 'base64url').toString())
        : 0;
}

const getNextCursor = (cursor: number, length: number) => {
    return cursor < length
        ? Buffer.from(String(cursor)).toString('base64url')
        : null;
}

const PORT = 3000;
const openApiDocument = parse(readFileSync('openapi/openapi.yaml', 'utf8'));

const app = express();

app.use(express.json());
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

app.use(middleware({
    apiSpec: 'openapi/openapi.yaml',
    validateRequests: true,
    validateResponses: true
}))

const products = [{ id: 1 }, { id: 2 }];
const orders: { id: number; total_cents: number }[] = [];

app.get('/products', (req, res) => {
    const limit = Number(req.query.limit) || products.length;
    const cursor = getCurrentCursor(req.query.cursor);
    const end = cursor + limit;
    const next_cursor = getNextCursor(end, products.length);
    res.json({ items: products.slice(cursor, end), next_cursor });
});

app.get('/products/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const product = products.find((p) => p.id === id);
    if (!product) {
        const error = new Error('Product not found');
        (error as { status?: number }).status = 404;
        next(error);
        return;
    }
    res.json(product);
});

app.post('/orders', (req, res) => {
    const order = { id: orders.length + 1, total_cents: 0 };
    orders.push(order);
    res.status(201).json(order);
});

app.get('/orders', (req, res) => {
    const limit = Number(req.query.limit) || orders.length;
    const cursor = getCurrentCursor(req.query.cursor);
    const end = cursor + limit;
    const next_cursor = getNextCursor(end, orders.length);

    res.json({ items: orders.slice(cursor, end), next_cursor });
});

app.get('/orders/:id', (req, res, next) => {
    const id = Number(req.params.id);
    const order = orders.find((o) => o.id === id);
    if (!order) {
        const error = new Error('Order not found');
        (error as { status?: number }).status = 404;
        next(error);
        return;
    }
    res.json(order);
});

const problemHandler: ErrorRequestHandler = (error, req, res, _next) => {
    const status = (error as { status?: number }).status ?? 500;
    const detail = error instanceof Error ? error.message : 'Unexpected error';
    res.status(status).type('application/problem+json').json({
        type: `https://api.marketplace.example/problems/${status}`,
        title: 'Error',
        status,
        detail,
        instance: req.originalUrl,
    });
};
app.use(problemHandler);

app.listen(PORT)