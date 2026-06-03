import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Unit test cho AuthController — kiểm chứng các điểm cuối uỷ thác đúng cho
 * AuthService và xử lý đúng các trường hợp biên (refresh thiếu token, logout
 * idempotent). AuthService được giả lập.
 */
describe('AuthController', () => {
  let controller: AuthController;
  let auth: any;

  beforeEach(async () => {
    auth = {
      register: jest.fn().mockResolvedValue({ accessToken: 'a' }),
      login: jest.fn().mockResolvedValue({ accessToken: 'a' }),
      refresh: jest.fn().mockResolvedValue({ accessToken: 'b' }),
      revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: auth }],
    }).compile();
    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => jest.clearAllMocks());

  it('register uỷ thác cho AuthService.register', async () => {
    const dto = { email: 'a@b.vn', password: 'P@ss1234', name: 'A' };
    await controller.register(dto as any);
    expect(auth.register).toHaveBeenCalledWith(dto);
  });

  it('login uỷ thác cho AuthService.login', async () => {
    const dto = { email: 'a@b.vn', password: 'P@ss1234' };
    await controller.login(dto as any);
    expect(auth.login).toHaveBeenCalledWith(dto);
  });

  it('verify trả về req.user (đã qua JwtAuthGuard)', async () => {
    const req = { user: { id: 'u1' } };
    await expect(controller.verify(req)).resolves.toEqual({ id: 'u1' });
  });

  it('me trả về req.user', async () => {
    const req = { user: { id: 'u1', email: 'a@b.vn' } };
    await expect(controller.me(req)).resolves.toMatchObject({ id: 'u1' });
  });

  it('refresh uỷ thác token cho AuthService.refresh', async () => {
    await controller.refresh({ refreshToken: 'raw' });
    expect(auth.refresh).toHaveBeenCalledWith('raw');
  });

  it('refresh ném Unauthorized khi thiếu refreshToken', async () => {
    await expect(controller.refresh({} as any)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(auth.refresh).not.toHaveBeenCalled();
  });

  it('logout thu hồi token khi được cung cấp', async () => {
    const res = await controller.logout({ refreshToken: 'raw' });
    expect(auth.revokeRefreshToken).toHaveBeenCalledWith('raw');
    expect(res).toEqual({ success: true });
  });

  it('logout vẫn trả success khi không có token (idempotent)', async () => {
    const res = await controller.logout({});
    expect(auth.revokeRefreshToken).not.toHaveBeenCalled();
    expect(res).toEqual({ success: true });
  });
});
