import { Controller, Post, Body, Get, Delete, UseGuards, Request, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './auth.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /** Verify access token — used by frontend on boot. */
  @Get('verify')
  @UseGuards(JwtAuthGuard)
  async verify(@Request() req) {
    return req.user;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Request() req) {
    return req.user;
  }

  /** Exchange refresh token for new access + refresh pair. */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() body: { refreshToken: string }) {
    if (!body.refreshToken) throw new UnauthorizedException('refreshToken required');
    return this.authService.refresh(body.refreshToken);
  }

  /** Logout — revoke refresh token. */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: { refreshToken?: string }) {
    if (body.refreshToken) {
      await this.authService.revokeRefreshToken(body.refreshToken);
    }
    return { success: true };
  }
}

