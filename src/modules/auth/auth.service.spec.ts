import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';

jest.mock('bcryptjs');

/**
 * Unit test cho AuthService — kiểm chứng lõi xác thực: đăng ký, đăng nhập,
 * xác minh và xoay vòng phiếu làm mới. PrismaService và JwtService được giả
 * lập hoàn toàn để cô lập logic nghiệp vụ khỏi cơ sở dữ liệu và mạng.
 */
describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
    authSession: {
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let jwt: { sign: jest.Mock; verify: jest.Mock };

  const fakeUser = {
    id: 'u1',
    email: 'guard@kpatrol.vn',
    password: 'hashed-pw',
    name: 'Bảo vệ A',
    role: 'OPERATOR',
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn() },
      authSession: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({ id: 's1' }),
        delete: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    jwt = {
      sign: jest.fn().mockReturnValue('access.jwt.token'),
      verify: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-pw');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  afterEach(() => jest.clearAllMocks());

  it('được khởi tạo', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const dto = { email: 'new@kpatrol.vn', password: 'Secret@123', name: 'Người mới' };

    it('tạo người dùng mới và trả về cặp phiếu khi email chưa tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...fakeUser, ...dto });

      const result = await service.register(dto as any);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: dto.email } });
      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 10);
      expect(prisma.user.create).toHaveBeenCalled();
      expect(result.accessToken).toBe('access.jwt.token');
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.user).toEqual({
        id: fakeUser.id,
        email: dto.email,
        name: dto.name,
        role: fakeUser.role,
      });
    });

    it('băm mật khẩu trước khi lưu (không lưu mật khẩu thô)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...fakeUser, ...dto });

      await service.register(dto as any);

      const createArg = prisma.user.create.mock.calls[0][0];
      expect(createArg.data.password).toBe('hashed-pw');
      expect(createArg.data.password).not.toBe(dto.password);
    });

    it('ném ConflictException khi email đã được đăng ký', async () => {
      prisma.user.findUnique.mockResolvedValue(fakeUser);

      await expect(service.register(dto as any)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('phát hành một phiên làm mới khi đăng ký', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...fakeUser, ...dto });

      await service.register(dto as any);

      expect(prisma.authSession.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('login', () => {
    const dto = { email: fakeUser.email, password: 'Secret@123' };

    it('trả về cặp phiếu khi thông tin hợp lệ', async () => {
      prisma.user.findUnique.mockResolvedValue(fakeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login(dto as any);

      expect(bcrypt.compare).toHaveBeenCalledWith(dto.password, fakeUser.password);
      expect(result.accessToken).toBe('access.jwt.token');
      expect(result.user.email).toBe(fakeUser.email);
    });

    it('ném UnauthorizedException khi email không tồn tại', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(dto as any)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('ném UnauthorizedException khi sai mật khẩu', async () => {
      prisma.user.findUnique.mockResolvedValue(fakeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto as any)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.authSession.create).not.toHaveBeenCalled();
    });

    it('không rò rỉ mật khẩu băm ra ngoài payload trả về', async () => {
      prisma.user.findUnique.mockResolvedValue(fakeUser);
      const result = await service.login(dto as any);
      expect((result.user as any).password).toBeUndefined();
    });
  });

  describe('validateUser', () => {
    it('truy vấn người dùng theo id, chỉ chọn trường công khai', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: fakeUser.id,
        email: fakeUser.email,
        name: fakeUser.name,
        role: fakeUser.role,
      });

      const result = await service.validateUser(fakeUser.id);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: fakeUser.id },
        select: { id: true, email: true, name: true, role: true },
      });
      expect(result).toMatchObject({ id: fakeUser.id });
    });
  });

  describe('verifyAccessToken', () => {
    it('trả về người dùng khi phiếu truy cập hợp lệ', async () => {
      jwt.verify.mockReturnValue({ sub: fakeUser.id });
      prisma.user.findUnique.mockResolvedValue({ id: fakeUser.id });

      const result = await service.verifyAccessToken('valid.token');

      expect(jwt.verify).toHaveBeenCalledWith('valid.token');
      expect(result).toMatchObject({ id: fakeUser.id });
    });

    it('trả về null khi phiếu truy cập không hợp lệ', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      const result = await service.verifyAccessToken('bad.token');

      expect(result).toBeNull();
    });
  });

  describe('refresh', () => {
    it('xoay vòng phiên: xoá phiên cũ, phát hành cặp phiếu mới', async () => {
      const future = new Date(Date.now() + 86_400_000);
      prisma.authSession.findUnique.mockResolvedValue({
        id: 's1',
        userId: fakeUser.id,
        token: 'raw-refresh',
        expiresAt: future,
        user: fakeUser,
      });

      const result = await service.refresh('raw-refresh');

      expect(prisma.authSession.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
      expect(prisma.authSession.create).toHaveBeenCalledTimes(1);
      expect(result.accessToken).toBe('access.jwt.token');
      expect(result.user.id).toBe(fakeUser.id);
    });

    it('ném UnauthorizedException và xoá phiên khi phiếu đã hết hạn', async () => {
      const past = new Date(Date.now() - 1000);
      prisma.authSession.findUnique.mockResolvedValue({
        id: 's-expired',
        userId: fakeUser.id,
        token: 'old',
        expiresAt: past,
        user: fakeUser,
      });

      await expect(service.refresh('old')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.authSession.delete).toHaveBeenCalledWith({ where: { id: 's-expired' } });
    });

    it('ném UnauthorizedException khi không tìm thấy phiên', async () => {
      prisma.authSession.findUnique.mockResolvedValue(null);

      await expect(service.refresh('không-tồn-tại')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.authSession.delete).not.toHaveBeenCalled();
    });
  });

  describe('revokeRefreshToken', () => {
    it('xoá mọi phiên trùng phiếu làm mới (đăng xuất)', async () => {
      await service.revokeRefreshToken('raw-refresh');

      expect(prisma.authSession.deleteMany).toHaveBeenCalledWith({
        where: { token: 'raw-refresh' },
      });
    });
  });
});
