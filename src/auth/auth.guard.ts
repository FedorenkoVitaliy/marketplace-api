import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, type AuthUser, type Role } from './auth.service.js';

type AuthedRequest = Request & { user?: AuthUser };

const ROLES_KEY = 'roles';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user,
);

/** Хто це: немає / битий / відкликаний токен → 401. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('bearer token required');
    req.user = await this.auth.authenticate(token);
    return true;
  }
}

/** Чи дозволено ролі: відомий користувач без потрібної ролі → 403. Власність — у сервісах. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.get<Role[] | undefined>(ROLES_KEY, ctx.getHandler());
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (roles && (!user || !roles.includes(user.role))) {
      throw new ForbiddenException('role not allowed');
    }
    return true;
  }
}
