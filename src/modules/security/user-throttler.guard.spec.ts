import { UserThrottlerGuard } from './user-throttler.guard';

/**
 * Unit test cho UserThrottlerGuard — bộ giới hạn tần suất theo NGƯỜI DÙNG
 * (thay vì theo IP) để tránh một client làm nghẽn cả mạng NAT dùng chung.
 * getTracker là protected nên ta gọi qua prototype mà không cần dựng đầy đủ
 * phụ thuộc của ThrottlerGuard.
 */
describe('UserThrottlerGuard.getTracker', () => {
  const getTracker = (req: any): Promise<string> => {
    const inst: any = Object.create(UserThrottlerGuard.prototype);
    return inst.getTracker(req);
  };

  it('ưu tiên khoá theo userId khi đã xác thực', async () => {
    await expect(getTracker({ user: { id: 'u1' }, headers: {} })).resolves.toBe('user:u1');
  });

  it('dùng IP từ X-Forwarded-For (hop đầu) khi chưa xác thực', async () => {
    await expect(
      getTracker({ headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' } }),
    ).resolves.toBe('ip:203.0.113.5');
  });

  it('lùi về req.ip khi không có forwarded header', async () => {
    await expect(getTracker({ headers: {}, ip: '198.51.100.7' })).resolves.toBe('ip:198.51.100.7');
  });

  it('trả ip:unknown khi không có thông tin nào', async () => {
    await expect(getTracker({ headers: {} })).resolves.toBe('ip:unknown');
  });
});
