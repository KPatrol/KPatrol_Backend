import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Minimal Helmet-equivalent headers — no new dependency.
 *
 * Why inline: the backend is a thin API, most attacks land on the PWA/CDN.
 * These six headers cover the OWASP baseline (clickjacking, MIME sniffing,
 * referrer leakage, mixed content) without pulling Helmet's full dep tree.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
    // JSON-only API — no inline scripts or remote content needed.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    next();
  }
}
