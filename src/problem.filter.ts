import {
    type ArgumentsHost,
    Catch,
    type ExceptionFilter,
    HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ProblemFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const req = ctx.getRequest<Request>();
        const res = ctx.getResponse<Response>();

        let status = 500;
        let detail: string | string[] = 'Unexpected error';

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const body = exception.getResponse();
            if (typeof body === 'string') {
                detail = body;
            } else if (typeof body === 'object' && body && 'message' in body) {
                detail = (body as { message: string | string[] }).message;
            }
        } else if (exception instanceof Error) {
            detail = exception.message;
            status = (exception as { status?: number }).status ?? 500;
        }

        res.status(status).type('application/problem+json').json({
            type: `https://api.marketplace.example/problems/${status}`,
            title: 'Error',
            status,
            detail: Array.isArray(detail) ? detail.join(', ') : detail,
            instance: req.originalUrl,
        });
    }
}
