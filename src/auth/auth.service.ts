import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import type { Env } from '../config/env.schema.js';
import { closeRedis, queueRedis } from '../redis/clients.js';
import { signAccess, verifyAccess, type AccessClaims } from './jwt.js';
import { loadKeys, type SigningKeys } from './keys.js';
import { verifyPassword } from './password.js';
import { issueFamily, revokeFamily, rotate } from './refresh-tokens.js';

export type Role = 'buyer' | 'seller' | 'admin';

export type AuthUser = {
  id: string;
  role: Role;
  jti: string;
  exp: number;
  familyId: string;
};

export type TokenPair = { accessToken: string; refreshToken: string };

const denyKey = (jti: string) => `auth:deny:${jti}`;

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly log = new Logger(AuthService.name);
  private readonly keys: SigningKeys;
  private redis?: Redis;

  constructor(
    @Inject('PG_POOL') private readonly pool: Pool,
    config: ConfigService<Env, true>,
  ) {
    this.keys = loadKeys({
      JWT_PRIVATE_KEY: config.get('JWT_PRIVATE_KEY', { infer: true }),
      JWT_PUBLIC_KEY: config.get('JWT_PUBLIC_KEY', { infer: true }),
      JWT_KID: config.get('JWT_KID', { infer: true }),
      REFRESH_TOKEN_PEPPER: config.get('REFRESH_TOKEN_PEPPER', { infer: true }),
    });
    this.log.log(`JWT ES256 kid=${this.keys.kid} fp=${this.keys.fingerprint}`);
  }

  async onModuleDestroy() {
    await closeRedis(this.redis);
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const { rows } = await this.pool.query<{ id: string; role: Role; password_hash: string | null }>(
      `SELECT id::text, role, password_hash FROM users WHERE email = $1`,
      [email],
    );
    const user = rows[0];
    if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) {
      throw new UnauthorizedException('invalid credentials');
    }
    const { familyId, refreshToken } = await issueFamily(this.pool, this.keys.pepper, user.id);
    return { accessToken: await signAccess(this.keys, user.id, user.role, familyId), refreshToken };
  }

  async refresh(presented: string): Promise<TokenPair> {
    const rotation = await rotate(this.pool, this.keys.pepper, presented);
    if (rotation.status === 'reuse') {
      this.log.warn(
        `refresh token reuse: user=${rotation.userId} family=${rotation.familyId} revoked`,
      );
    }
    if (rotation.status !== 'ok') throw new UnauthorizedException('invalid refresh token');

    const role = await this.roleOf(rotation.userId);
    return {
      accessToken: await signAccess(this.keys, rotation.userId, role, rotation.familyId),
      refreshToken: rotation.refreshToken,
    };
  }

  /**
   * Дві дії логауту. Денилист access — першим: якщо Redis недоступний, падаємо
   * з 500 і сімʼя ще жива (можна повторити). Навпаки (PG → Redis) лишило б
   * access живим до exp при вже мертвій сімʼї.
   */
  async logout(user: AuthUser): Promise<void> {
    const ttl = user.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) await this.denylist().set(denyKey(user.jti), '1', 'EX', ttl);
    await revokeFamily(this.pool, user.familyId);
  }

  /** Підпис → денилист → роль з БД. Денилист після підпису: сміттєві токени не йдуть у Redis. */
  async authenticate(token: string): Promise<AuthUser> {
    let claims: AccessClaims;
    try {
      claims = await verifyAccess(this.keys, token);
    } catch {
      throw new UnauthorizedException('invalid token');
    }
    if (await this.denylist().exists(denyKey(claims.jti))) {
      throw new UnauthorizedException('token revoked');
    }
    return {
      id: claims.sub,
      role: await this.roleOf(claims.sub),
      jti: claims.jti,
      exp: claims.exp,
      familyId: claims.fid,
    };
  }

  private async roleOf(userId: string): Promise<Role> {
    const { rows } = await this.pool.query<{ role: Role }>(
      `SELECT role FROM users WHERE id = $1`,
      [userId],
    );
    if (!rows[0]) throw new UnauthorizedException('user not found');
    return rows[0].role;
  }

  private denylist(): Redis {
    this.redis ??= queueRedis();
    return this.redis;
  }
}
