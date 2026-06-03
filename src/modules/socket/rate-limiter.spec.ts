import { TokenBucketRateLimiter } from './rate-limiter';

/**
 * Unit test cho bộ giới hạn tần suất kiểu xô token (token bucket) dùng cho các
 * sự kiện control:* của socket. Hàm tryAcquire nhận mốc thời gian `now` tường
 * minh nên kiểm chứng nạp lại token một cách tất định, không cần giả lập Date.
 */
describe('TokenBucketRateLimiter', () => {
  it('cho phép bùng nổ tới hạn dung lượng rồi từ chối', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 3, refillPerSec: 1 });
    const t = 1_000_000;
    expect(rl.tryAcquire('s1', t)).toBe(true);
    expect(rl.tryAcquire('s1', t)).toBe(true);
    expect(rl.tryAcquire('s1', t)).toBe(true);
    expect(rl.tryAcquire('s1', t)).toBe(false); // hết token
  });

  it('nạp lại token theo thời gian trôi qua', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 2, refillPerSec: 10 });
    const t0 = 1_000_000;
    rl.tryAcquire('s1', t0);
    rl.tryAcquire('s1', t0); // cạn
    expect(rl.tryAcquire('s1', t0)).toBe(false);
    // sau 0,2 s × 10 token/s = +2 token
    expect(rl.tryAcquire('s1', t0 + 200)).toBe(true);
  });

  it('không vượt quá dung lượng dù chờ lâu', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 5, refillPerSec: 100 });
    const t0 = 1_000_000;
    rl.tryAcquire('s1', t0);
    // chờ rất lâu — token bị giới hạn ở capacity = 5
    rl.tryAcquire('s1', t0 + 10_000);
    expect(rl.peek('s1')).toBeLessThanOrEqual(5);
  });

  it('các khoá (socket) độc lập với nhau', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 1, refillPerSec: 1 });
    const t = 1_000_000;
    expect(rl.tryAcquire('a', t)).toBe(true);
    expect(rl.tryAcquire('a', t)).toBe(false);
    expect(rl.tryAcquire('b', t)).toBe(true); // khoá b chưa bị ảnh hưởng
  });

  it('release xoá bucket (peek trả NaN)', () => {
    const rl = new TokenBucketRateLimiter({ capacity: 2, refillPerSec: 1 });
    rl.tryAcquire('s1', 1_000_000);
    rl.release('s1');
    expect(Number.isNaN(rl.peek('s1'))).toBe(true);
  });

  it('mặc định dung lượng 30, nạp 15/giây', () => {
    const rl = new TokenBucketRateLimiter();
    const t = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 40; i++) if (rl.tryAcquire('s1', t)) allowed++;
    expect(allowed).toBe(30); // đúng dung lượng mặc định
  });
});
