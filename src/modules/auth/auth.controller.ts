import { Controller, Post, Body, Get, Delete, UseGuards, Request, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Auth endpoints — registration, login, JWT verification, and refresh-token lifecycle.
 *
 * All token signing/verification flows through the centralized JWT_SECRET in
 * {@link import('../../config/auth.config').getJwtSecret}, so AuthModule and
 * JwtStrategy can never drift apart.
 */
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Create a new user account.
   * Returns the access + refresh token pair so the client can log in immediately
   * without a follow-up `/login` call.
   */
  // Strict rate limit on register — a public endpoint that always hits the
  // password hasher (bcrypt is expensive on purpose). Without this an
  // attacker could DOS the API and run up the DB by spamming /register.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * Exchange email/password for an access + refresh token pair.
   * Forced to 200 (instead of POST's default 201) because no resource is created.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Verify access token — used by the frontend on boot to restore the session. */
  @Get('verify')
  @UseGuards(JwtAuthGuard)
  async verify(@Request() req) {
    return req.user;
  }

  /** Return the authenticated user's profile (resolved from the JWT). */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Request() req) {
    return req.user;
  }

  /**
   * Exchange a refresh token for a new access + refresh pair.
   * The previous refresh token is revoked atomically inside AuthService to
   * prevent token reuse across simultaneous refreshes.
   */
  // Rate limit refresh — a stolen refresh token in the wild could otherwise
  // be replayed to mint access tokens at line rate. 30/min is well above
  // what any legitimate client needs (web apps refresh once per access-token
  // TTL, ~15 min in our config).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { refreshToken: string }) {
    if (!body.refreshToken) throw new UnauthorizedException('refreshToken required');
    return this.authService.refresh(body.refreshToken);
  }

  /**
   * Logout by revoking the refresh token server-side.
   * Always returns success — clients can safely call this even after the
   * refresh token has already expired or been revoked.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: { refreshToken?: string }) {
    if (body.refreshToken) {
      await this.authService.revokeRefreshToken(body.refreshToken);
    }
    return { success: true };
  }
}

