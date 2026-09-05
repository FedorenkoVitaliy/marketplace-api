import 'reflect-metadata';
import express, { type ErrorRequestHandler } from 'express';
import { middleware } from 'express-openapi-validator';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

const PORT = 3000;
const app = express();

app.use(express.json());
app.use(middleware({
    apiSpec: 'openapi/openapi.yaml',
    validateRequests: true,
    validateResponses: true,
}));

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

async function bootstrap() {
    const nestApp = await NestFactory.create(
        AppModule,
        new ExpressAdapter(app),
        { bodyParser: false },
    );
    nestApp.enableShutdownHooks();
    app.use(problemHandler);
    await nestApp.listen(PORT);
}
bootstrap();
