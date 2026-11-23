import { type ArgumentsHost, Catch, type HttpServer } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

@Catch()
export class ObserveExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{ locals: { errorDetail?: string } }>();
    response.locals.errorDetail = exception instanceof Error ? exception.message : 'Unexpected error';
    super.catch(exception, host);
  }

  handleUnknownError(exception: unknown, host: ArgumentsHost, applicationRef: HttpServer): void {
    const httpError = this.isHttpError(exception) ? exception : undefined;
    const status = httpError ? httpError.statusCode : 500;
    const response = host.getArgByIndex(1);
    if (!applicationRef.isHeadersSent(response)) {
      applicationRef.reply(response, {
        statusCode: status,
        message: httpError ? httpError.message : 'Internal server error',
      }, status);
    }
  }
}
