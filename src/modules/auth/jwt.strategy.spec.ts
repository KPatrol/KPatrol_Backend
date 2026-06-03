import { JwtStrategy } from './jwt.strategy';

/**
 * Unit test cho JwtStrategy.validate — gắn người dùng vào ngữ cảnh yêu cầu sau
 * khi xác minh chữ ký phiếu. Gọi qua prototype để tránh super() của Passport
 * (vốn cần JWT_SECRET ở thời điểm khởi tạo).
 */
describe('JwtStrategy.validate', () => {
  it('uỷ thác cho AuthService.validateUser với sub của payload', async () => {
    const authService = { validateUser: jest.fn().mockResolvedValue({ id: 'u1' }) };
    const strat: any = Object.create(JwtStrategy.prototype);
    strat.authService = authService;

    const result = await strat.validate({ sub: 'u1' });

    expect(authService.validateUser).toHaveBeenCalledWith('u1');
    expect(result).toEqual({ id: 'u1' });
  });

  it('trả null khi validateUser không tìm thấy người dùng', async () => {
    const authService = { validateUser: jest.fn().mockResolvedValue(null) };
    const strat: any = Object.create(JwtStrategy.prototype);
    strat.authService = authService;

    await expect(strat.validate({ sub: 'ghost' })).resolves.toBeNull();
  });
});
