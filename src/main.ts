import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { middleware } from 'express-openapi-validator';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { type Env } from './config/env.schema.js';

export async function createHttpApp(): Promise<{
    app: Express;
    listen: (port: number) => Promise<void>;
    close: () => Promise<void>;
    port: () => number;
    url: () => string;
}> {
    const app = express();

    app.use(express.json());
    app.use(middleware({
        apiSpec: 'openapi/openapi.yaml',
        validateRequests: true,
        validateResponses: true,
        ignorePaths: (path: string) => path === '/health' || path === '/db',
    }));

    const nestApp = await NestFactory.create(
        AppModule,
        new ExpressAdapter(app),
        { bodyParser: false },
    );
    const config = nestApp.get(ConfigService<Env, true>);

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

    nestApp.enableShutdownHooks();
    app.use(problemHandler);

    return {
        app,
        listen: async (port: number) => {
            await nestApp.listen(port);
        },
        close: async () => {
            await nestApp.close();
        },
        port: () => config.get('PORT', { infer: true }),
        url: () => {
            const addr = nestApp.getHttpServer().address();
            if (addr && typeof addr === 'object') return `http://127.0.0.1:${addr.port}`;
            throw new Error('сервер не слухає порт');
        },
    };
}

const isEntry = process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntry) {
    const http = await createHttpApp();
    await http.listen(http.port());
}
