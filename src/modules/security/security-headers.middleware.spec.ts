import { SecurityHeadersMiddleware } from './security-headers.middleware';

/**
 * Unit test cho SecurityHeadersMiddleware — gắn 6 tiêu đề bảo mật theo chuẩn
 * cơ bản OWASP (chống clickjacking, MIME sniffing, rò rỉ referrer, nội dung
 * hỗn hợp) và luôn gọi next() để không chặn luồng yêu cầu.
 */
describe('SecurityHeadersMiddleware', () => {
  const mw = new SecurityHeadersMiddleware();
  let res: { setHeader: jest.Mock };
  let next: jest.Mock;

  beforeEach(() => {
    res = { setHeader: jest.fn() };
    next = jest.fn();
    mw.use({} as any, res as any, next as any);
  });

  it('đặt X-Content-Type-Options: nosniff', () => {
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
  });

  it('đặt X-Frame-Options: DENY (chống clickjacking)', () => {
    expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
  });

  it('đặt Referrer-Policy', () => {
    expect(res.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'strict-origin-when-cross-origin');
  });

  it('đặt Strict-Transport-Security (HSTS)', () => {
    expect(res.setHeader).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );
  });

  it('đặt Content-Security-Policy chặt cho API JSON', () => {
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
  });

  it('gọi next() đúng một lần', () => {
    expect(next).toHaveBeenCalledTimes(1);
  });
});
