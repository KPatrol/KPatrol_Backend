import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RobotService } from './robot.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Unit test cho RobotService — bao phủ kiểm soát quyền sở hữu (cốt lõi bảo
 * mật RBAC), bộ nhớ đệm sở hữu trên đường nóng tay cầm ảo, quản lý phiên –
 * tuần tra – cảnh báo, và xác thực lịch bật đèn. PrismaService được giả lập.
 */
describe('RobotService', () => {
  let service: RobotService;
  let prisma: any;

  const OWNER = 'owner-1';
  const OTHER = 'intruder-9';
  const robotRow = { id: 'r1', userId: OWNER, serialNumber: 'KPATROL-001' };

  beforeEach(async () => {
    prisma = {
      robot: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      robotSession: { updateMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      patrol: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
        update: jest.fn(),
      },
      patrolLog: { create: jest.fn() },
      alert: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RobotService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<RobotService>(RobotService);
  });

  afterEach(() => jest.clearAllMocks());

  it('được khởi tạo', () => {
    expect(service).toBeDefined();
  });

  // ── Đường nóng tay cầm ảo + bộ nhớ đệm sở hữu ──────────────────────────
  describe('findOneForCommand', () => {
    it('truy vấn DB lần đầu rồi trả serialNumber khi đúng chủ sở hữu', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      const res = await service.findOneForCommand('r1', OWNER);
      expect(res).toEqual({ serialNumber: 'KPATROL-001' });
      expect(prisma.robot.findUnique).toHaveBeenCalledTimes(1);
    });

    it('lần gọi thứ hai dùng cache, KHÔNG truy vấn DB lại', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      await service.findOneForCommand('r1', OWNER);
      await service.findOneForCommand('r1', OWNER);
      expect(prisma.robot.findUnique).toHaveBeenCalledTimes(1);
    });

    it('ném NotFoundException khi robot không tồn tại', async () => {
      prisma.robot.findUnique.mockResolvedValue(null);
      await expect(service.findOneForCommand('r1', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ném ForbiddenException khi robot thuộc người khác', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      await expect(service.findOneForCommand('r1', OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('truy vấn lại DB sau khi cache hết hạn (TTL 60 s)', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      await service.findOneForCommand('r1', OWNER);
      nowSpy.mockReturnValue(1_000_000 + 61_000); // quá 60 s
      await service.findOneForCommand('r1', OWNER);
      expect(prisma.robot.findUnique).toHaveBeenCalledTimes(2);
      nowSpy.mockRestore();
    });

    it('invalidateOwnershipCache buộc truy vấn lại cho robot đó', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      await service.findOneForCommand('r1', OWNER);
      service.invalidateOwnershipCache('r1');
      await service.findOneForCommand('r1', OWNER);
      expect(prisma.robot.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  // ── create ─────────────────────────────────────────────────────────────
  describe('create', () => {
    it('tạo robot với trạng thái OFFLINE', async () => {
      prisma.robot.create.mockResolvedValue({ id: 'r2' });
      await service.create(OWNER, { name: 'Robot 2', serialNumber: 'KPATROL-002' } as any);
      const arg = prisma.robot.create.mock.calls[0][0];
      expect(arg.data.userId).toBe(OWNER);
      expect(arg.data.status).toBe('OFFLINE');
    });

    it('tự sinh serialNumber khi DTO không cung cấp', async () => {
      prisma.robot.create.mockResolvedValue({ id: 'r3' });
      await service.create(OWNER, { name: 'Robot 3' } as any);
      const arg = prisma.robot.create.mock.calls[0][0];
      expect(arg.data.serialNumber).toMatch(/^KPATROL-/);
    });

    it('ném ConflictException khi trùng serialNumber (P2002)', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5.10.2',
      });
      prisma.robot.create.mockRejectedValue(p2002);
      await expect(
        service.create(OWNER, { name: 'X', serialNumber: 'KPATROL-001' } as any),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('ném lại lỗi không phải P2002', async () => {
      prisma.robot.create.mockRejectedValue(new Error('db down'));
      await expect(service.create(OWNER, { name: 'X' } as any)).rejects.toThrow('db down');
    });
  });

  // ── findOne / update / remove ────────────────────────────────────────────
  describe('findOne', () => {
    it('trả robot khi đúng chủ sở hữu', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      await expect(service.findOne('r1', OWNER)).resolves.toEqual(robotRow);
    });
    it('ném NotFoundException khi không tồn tại', async () => {
      prisma.robot.findUnique.mockResolvedValue(null);
      await expect(service.findOne('r1', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('ném ForbiddenException khi sai chủ sở hữu', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      await expect(service.findOne('r1', OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update', () => {
    it('kiểm tra sở hữu rồi cập nhật', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      prisma.robot.update.mockResolvedValue({ id: 'r1', name: 'Tên mới' });
      const res = await service.update('r1', OWNER, { name: 'Tên mới' } as any);
      expect(prisma.robot.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { name: 'Tên mới' } });
      expect(res.name).toBe('Tên mới');
    });
    it('không cập nhật khi sai chủ sở hữu', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      await expect(service.update('r1', OTHER, { name: 'x' } as any)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.robot.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('kiểm tra sở hữu rồi xoá', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      prisma.robot.delete.mockResolvedValue(robotRow);
      await service.remove('r1', OWNER);
      expect(prisma.robot.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
    });
  });

  // ── status / battery ─────────────────────────────────────────────────────
  describe('updateStatus & updateBatteryLevel', () => {
    it('updateStatus ghi kèm lastSeen', async () => {
      prisma.robot.update.mockResolvedValue({});
      await service.updateStatus('r1', 'ONLINE' as any);
      const arg = prisma.robot.update.mock.calls[0][0];
      expect(arg.data.status).toBe('ONLINE');
      expect(arg.data.lastSeen).toBeInstanceOf(Date);
    });
    it('updateBatteryLevel ghi mức pin', async () => {
      prisma.robot.update.mockResolvedValue({});
      await service.updateBatteryLevel('r1', 73);
      expect(prisma.robot.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { batteryLevel: 73 } });
    });
  });

  // ── session ──────────────────────────────────────────────────────────────
  describe('startSession', () => {
    it('đóng phiên đang mở trước khi tạo phiên mới', async () => {
      prisma.robotSession.updateMany.mockResolvedValue({ count: 1 });
      prisma.robotSession.create.mockResolvedValue({ id: 'sess1' });
      await service.startSession('r1');
      expect(prisma.robotSession.updateMany).toHaveBeenCalledWith({
        where: { robotId: 'r1', endedAt: null },
        data: { endedAt: expect.any(Date) },
      });
      expect(prisma.robotSession.create).toHaveBeenCalled();
    });
  });

  // ── patrol ───────────────────────────────────────────────────────────────
  describe('patrol', () => {
    it('createPatrol kiểm tra sở hữu rồi tạo patrol PENDING', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      prisma.patrol.create.mockResolvedValue({ id: 'p1' });
      await service.createPatrol('r1', OWNER, 'Tuyến A', { points: [] });
      const arg = prisma.patrol.create.mock.calls[0][0];
      expect(arg.data.status).toBe('PENDING');
      expect(arg.data.name).toBe('Tuyến A');
    });

    it('deletePatrol ném NotFound khi patrol không tồn tại', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      prisma.patrol.findUnique.mockResolvedValue(null);
      await expect(service.deletePatrol('r1', 'pX', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updatePatrolStatus ném Forbidden khi patrol thuộc robot khác', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      prisma.patrol.findUnique.mockResolvedValue({ id: 'p1', robotId: 'r-other' });
      await expect(
        service.updatePatrolStatus('r1', 'p1', OWNER, 'RUNNING'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('updatePatrolStatus cập nhật khi hợp lệ', async () => {
      prisma.robot.findUnique.mockResolvedValue(robotRow);
      prisma.patrol.findUnique.mockResolvedValue({ id: 'p1', robotId: 'r1' });
      prisma.patrol.update.mockResolvedValue({ id: 'p1', status: 'RUNNING' });
      const res = await service.updatePatrolStatus('r1', 'p1', OWNER, 'RUNNING');
      expect(res.status).toBe('RUNNING');
    });
  });

  // ── gateway helpers ──────────────────────────────────────────────────────
  describe('assertOwnership & patrolBelongsToRobot', () => {
    it('assertOwnership không ném khi đúng chủ', async () => {
      prisma.robot.findUnique.mockResolvedValue({ userId: OWNER });
      await expect(service.assertOwnership('r1', OWNER)).resolves.toBeUndefined();
    });
    it('assertOwnership ném Forbidden khi sai chủ', async () => {
      prisma.robot.findUnique.mockResolvedValue({ userId: OWNER });
      await expect(service.assertOwnership('r1', OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('patrolBelongsToRobot trả true/false đúng', async () => {
      prisma.patrol.findUnique.mockResolvedValueOnce({ robotId: 'r1' });
      await expect(service.patrolBelongsToRobot('p1', 'r1')).resolves.toBe(true);
      prisma.patrol.findUnique.mockResolvedValueOnce({ robotId: 'r2' });
      await expect(service.patrolBelongsToRobot('p1', 'r1')).resolves.toBe(false);
    });
  });

  // ── alert ────────────────────────────────────────────────────────────────
  describe('acknowledgeAlert', () => {
    it('xác nhận cảnh báo khi đúng chủ robot', async () => {
      prisma.alert.findUnique.mockResolvedValue({ id: 'a1', robot: { userId: OWNER } });
      prisma.alert.update.mockResolvedValue({ id: 'a1', acknowledged: true });
      const res = await service.acknowledgeAlert('a1', OWNER);
      expect(res.acknowledged).toBe(true);
    });
    it('ném NotFound khi cảnh báo không tồn tại', async () => {
      prisma.alert.findUnique.mockResolvedValue(null);
      await expect(service.acknowledgeAlert('a1', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('ném Forbidden khi cảnh báo thuộc robot người khác', async () => {
      prisma.alert.findUnique.mockResolvedValue({ id: 'a1', robot: { userId: OWNER } });
      await expect(service.acknowledgeAlert('a1', OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── config ───────────────────────────────────────────────────────────────
  describe('getConfig', () => {
    it('không trả về userId trong cấu hình', async () => {
      prisma.robot.findUnique.mockResolvedValue({ id: 'r1', userId: OWNER, name: 'A', serialNumber: 'KPATROL-001' });
      const res = await service.getConfig('r1', OWNER);
      expect((res as any).userId).toBeUndefined();
      expect(res.id).toBe('r1');
    });
    it('ném Forbidden khi sai chủ', async () => {
      prisma.robot.findUnique.mockResolvedValue({ id: 'r1', userId: OWNER });
      await expect(service.getConfig('r1', OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── light schedule validation ───────────────────────────────────────────
  describe('updateLightSchedule', () => {
    beforeEach(() => prisma.robot.findUnique.mockResolvedValue(robotRow));

    it('lưu lịch khi giờ hợp lệ HH:MM', async () => {
      prisma.robot.update.mockResolvedValue({
        serialNumber: 'KPATROL-001',
        mainLightScheduleEnabled: true,
        mainLightScheduleStart: '18:00',
        mainLightScheduleEnd: '06:00',
      });
      const res = await service.updateLightSchedule('r1', OWNER, { enabled: true, start: '18:00', end: '06:00' });
      expect(res).toEqual({ serialNumber: 'KPATROL-001', enabled: true, start: '18:00', end: '06:00' });
    });

    it('ném khi giờ bắt đầu sai định dạng', async () => {
      await expect(
        service.updateLightSchedule('r1', OWNER, { enabled: true, start: '6h', end: '06:00' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('ném khi bật nhưng thiếu giờ kết thúc', async () => {
      await expect(
        service.updateLightSchedule('r1', OWNER, { enabled: true, start: '18:00', end: null }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('khi tắt lịch thì xoá giờ (start/end = null)', async () => {
      prisma.robot.update.mockResolvedValue({
        serialNumber: 'KPATROL-001',
        mainLightScheduleEnabled: false,
        mainLightScheduleStart: null,
        mainLightScheduleEnd: null,
      });
      const res = await service.updateLightSchedule('r1', OWNER, { enabled: false });
      expect(res.enabled).toBe(false);
      expect(res.start).toBeNull();
    });
  });
});
