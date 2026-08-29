import express, { type ErrorRequestHandler } from 'express';
import { middleware } from 'express-openapi-validator';

const PORT = 3000;

const app = express();

app.use(express.json());

app.use(middleware({
    apiSpec: 'openapi/openapi.yaml',
    validateRequests: true,
    validateResponses: true
}))

const products = [{ id: 1 }, { id: 2 }];
const orders: { id: number; total_cents: number }[] = [];

app.get('/products', (req, res) => {
    res.json({ items: products, next_cursor: null });
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