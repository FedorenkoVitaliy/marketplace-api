import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser } from './auth.guard.js';
import { AuthService, type AuthUser } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user);
  }
}
