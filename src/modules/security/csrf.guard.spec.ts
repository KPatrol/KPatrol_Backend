import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CsrfGuard, issueCsrfToken, CSRF_COOKIE_NAME } from './csrf.guard';

/**
 * Unit test cho CsrfGuard — bảo vệ kiểu double-submit cookie. Chỉ áp dụng khi
 * route được đánh dấu @RequireCsrf(); phương thức an toàn (GET/HEAD/OPTIONS)
 * luôn qua; so khớp cookie và header bằng so sánh thời gian hằng định.
 */
describe('CsrfGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: CsrfGuard;

  const ctx = (req: any) =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as any;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new CsrfGuard(reflector as unknown as Reflector);
  });

  it('cho qua khi route KHÔNG yêu cầu CSRF', () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    expect(guard.canActivate(ctx({ method: 'POST' }))).toBe(true);
  });

  it('cho qua phương thức an toàn (GET) dù route yêu cầu CSRF', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(guard.canActivate(ctx({ method: 'GET', headers: {} }))).toBe(true);
  });

  it('ném Forbidden khi POST mà thiếu cookie/header', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    expect(() => guard.canActivate(ctx({ method: 'POST', headers: {} }))).toThrow(ForbiddenException);
  });

  it('cho qua khi cookie và header khớp', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const token = 'a'.repeat(48);
    const req = {
      method: 'POST',
      headers: { cookie: `${CSRF_COOKIE_NAME}=${token}`, 'x-csrf-token': token },
    };
    expect(guard.canActivate(ctx(req))).toBe(true);
  });

  it('ném Forbidden khi cookie và header lệch nhau', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const req = {
      method: 'POST',
      headers: { cookie: `${CSRF_COOKIE_NAME}=aaa`, 'x-csrf-token': 'bbb' },
    };
    expect(() => guard.canActivate(ctx(req))).toThrow(ForbiddenException);
  });

  it('issueCsrfToken sinh chuỗi hex 48 ký tự', () => {
    const t = issueCsrfToken();
    expect(t).toMatch(/^[0-9a-f]{48}$/);
  });

  it('hai token sinh ra khác nhau', () => {
    expect(issueCsrfToken()).not.toBe(issueCsrfToken());
  });
});
