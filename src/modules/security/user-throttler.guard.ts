import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Per-user rate limiter.
 *
 * The default `ThrottlerGuard` keys by IP, which breaks behind a shared NAT
 * (office WiFi, school LAN, mobile carrier) — one noisy client throttles
 * every other user on the same egress IP.
 *
 * This guard prefers the authenticated user ID from the JWT when present,
 * and falls back to IP only for unauthenticated routes (login, health).
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?.id;
    if (userId) return `user:${userId}`;

    // Fallback: IP. Honour `X-Forwarded-For` first hop when behind nginx.
    const fwd = req?.headers?.['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
      return `ip:${fwd.split(',')[0].trim()}`;
    }
    return `ip:${req?.ip ?? 'unknown'}`;
  }
}
