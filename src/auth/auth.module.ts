import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard, RolesGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, RolesGuard],
  exports: [AuthService, AuthGuard, RolesGuard],
})
export class AuthModule {}
