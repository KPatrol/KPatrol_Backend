/**
 * Per-socket token-bucket rate limiter for `control:*` events.
 *
 * Why token bucket and not a fixed window:
 *   - Operators legitimately burst commands (rapid-fire move adjustments while
 *     navigating tight corners) — a fixed N/sec cap would clip them right
 *     when they need responsiveness most.
 *   - Sustained mashing (auto-clicker, broken JS loop) must still be capped
 *     so a runaway client can't DoS the Pi over UART.
 *
 * Defaults sized for human teleop:
 *   - Capacity 30 tokens, refill 15/sec → bursts up to 30 commands then
 *     ~15 Hz steady — well below the 50 Hz UART throughput limit.
 *
 * Emergency stops bypass the limiter entirely (`isEmergency` parameter on the
 * gateway side); we never want to throttle a panic button.
 */

export interface RateLimiterOptions {
  /** Max tokens the bucket can hold — also the burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly capacity: number;
  private readonly refillPerSec: number;

  constructor(opts: Partial<RateLimiterOptions> = {}) {
    this.capacity = opts.capacity ?? 30;
    this.refillPerSec = opts.refillPerSec ?? 15;
  }

  /**
   * Try to consume one token from the bucket identified by `key`. Returns
   * true if the request is allowed, false if it should be dropped.
   */
  tryAcquire(key: string, now: number = Date.now()): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillMs: now };
      this.buckets.set(key, bucket);
    } else {
      const elapsed = (now - bucket.lastRefillMs) / 1000;
      if (elapsed > 0) {
        bucket.tokens = Math.min(
          this.capacity,
          bucket.tokens + elapsed * this.refillPerSec,
        );
        bucket.lastRefillMs = now;
      }
    }
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Drop a bucket — call on disconnect to free memory. */
  release(key: string): void {
    this.buckets.delete(key);
  }

  /** Diagnostic: current token count for a bucket (NaN if unknown). */
  peek(key: string): number {
    return this.buckets.get(key)?.tokens ?? NaN;
  }
}
