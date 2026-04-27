import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { CSRF_COOKIE_NAME, issueCsrfToken } from './csrf.guard';

/**
 * Issues a CSRF token + cookie pair for the double-submit scheme.
 * GET /api/security/csrf → Set-Cookie + `{ token }`.
 */
@Controller('security')
export class CsrfController {
  @Get('csrf')
  issue(@Res({ passthrough: true }) res: Response) {
    const token = issueCsrfToken();
    // `httpOnly: false` is intentional — client JS must read it to mirror
    // into the X-CSRF-Token header (that's what makes double-submit work).
    // Secrecy of the token is not the security property; origin-binding is.
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 1000 * 60 * 60 * 8, // 8h
    });
    return { token };
  }
}
