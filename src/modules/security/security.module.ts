import { Module } from '@nestjs/common';
import { CsrfController } from './csrf.controller';
import { CsrfGuard } from './csrf.guard';

/**
 * Hosts opt-in security primitives: CSRF double-submit endpoint/guard.
 *
 * The per-user rate limiter and security headers middleware are wired at the
 * app level (app.module.ts) because they apply globally; this module scopes
 * the CSRF route under `/api/security/csrf` and exposes the guard provider.
 */
@Module({
  controllers: [CsrfController],
  providers: [CsrfGuard],
  exports: [CsrfGuard],
})
export class SecurityModule {}
