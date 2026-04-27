import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * Double-submit cookie CSRF guard.
 *
 * Why: the mobile PWA currently uses `Authorization: Bearer <jwt>` which is
 * immune to CSRF (the browser won't auto-attach it). But some routes may
 * eventually switch to cookie-based sessions (e.g. for a signed-in web
 * dashboard served from the same origin), and the thesis security chapter
 * should demonstrate defense-in-depth. This guard is opt-in via the
 * `@RequireCsrf()` decorator, so it does not block JWT-authenticated
 * endpoints by default.
 *
 * Protocol:
 *   1. Client fetches GET /api/auth/csrf → sets `kpatrol_csrf` cookie and
 *      returns `{ token }` in the body.
 *   2. Subsequent mutating request sends the token in header `X-CSRF-Token`.
 *   3. Guard compares cookie vs. header with a constant-time check.
 *
 * Safe methods (GET, HEAD, OPTIONS) are always allowed.
 */

export const CSRF_REQUIRED_KEY = 'csrf:required';
export const RequireCsrf = () => (target: any, key?: any, desc?: any) => {
  if (desc) Reflect.defineMetadata(CSRF_REQUIRED_KEY, true, desc.value);
  else Reflect.defineMetadata(CSRF_REQUIRED_KEY, true, target);
};

export const CSRF_COOKIE_NAME = 'kpatrol_csrf';
const HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(): string {
  return randomBytes(24).toString('hex');
}

function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(
      CSRF_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest();
    if (SAFE_METHODS.has(req.method)) return true;

    // Parse cookies manually — avoids adding cookie-parser as a dep when the
    // rest of the app is bearer-token based.
    const cookieHeader: string | undefined = req.headers?.cookie;
    let cookieToken = '';
    if (cookieHeader) {
      for (const part of cookieHeader.split(';')) {
        const [k, v] = part.trim().split('=');
        if (k === CSRF_COOKIE_NAME && v) {
          cookieToken = decodeURIComponent(v);
          break;
        }
      }
    }
    const headerToken = req.headers?.[HEADER] as string | undefined;
    if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
      throw new ForbiddenException('CSRF token mismatch');
    }
    return true;
  }
}
