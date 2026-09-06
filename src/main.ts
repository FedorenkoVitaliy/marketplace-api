import 'reflect-metadata';
import express, { type ErrorRequestHandler } from 'express';
import { middleware } from 'express-openapi-validator';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { type Env } from './config/env.schema.js';

const app = express();

app.use(express.json());
app.use(middleware({
    apiSpec: 'openapi/openapi.yaml',
    validateRequests: true,
    validateResponses: true,
    ignorePaths: (path: string) => {
        if(path === '/health' || path === '/db'){
            return true
        } else {
            return false
        }
    }
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
    const config = nestApp.get(ConfigService<Env, true>);
    const configPort = config.get('PORT', { infer: true });

    nestApp.enableShutdownHooks();
    app.use(problemHandler);
    await nestApp.listen(configPort);
}
bootstrap();
