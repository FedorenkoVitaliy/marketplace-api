import { BadRequestException, Body, Controller, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.service.js';
import { FilesService } from './files.service.js';

type IntentBody = { contentType?: string; filename?: string; expiresIn?: number; size?: number };
type CommitBody = { key?: string; size?: number };
type ResumeBody = { key?: string; size?: number; expiresIn?: number };

@Controller('uploads')
@UseGuards(AuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('intent')
  @HttpCode(200)
  intent(
    @Body() body: IntentBody,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (!body?.contentType) throw new BadRequestException('contentType required');
    return this.files.intent(user.id, body.contentType, body.expiresIn, idempotencyKey, body.size);
  }

  @Post('resume')
  @HttpCode(200)
  resume(@Body() body: ResumeBody, @CurrentUser() user: AuthUser) {
    if (!body?.key || body.size === undefined) throw new BadRequestException('key and size required');
    return this.files.resume(user.id, body.key, body.size, body.expiresIn);
  }

  @Post('complete')
  @HttpCode(200)
  complete(@Body() body: CommitBody, @CurrentUser() user: AuthUser) {
    if (!body?.key) throw new BadRequestException('key required');
    return this.files.complete(user.id, body.key);
  }

  @Post('commit')
  @HttpCode(200)
  commit(@Body() body: CommitBody, @CurrentUser() user: AuthUser) {
    if (!body?.key) throw new BadRequestException('key required');
    return this.files.commit(user.id, body.key, body.size);
  }
}
