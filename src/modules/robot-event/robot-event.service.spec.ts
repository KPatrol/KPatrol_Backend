import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { RobotEventService } from './robot-event.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

const flush = () => new Promise((r) => setImmediate(r));

/**
 * Unit test cho RobotEventService — nhật ký sự kiện robot có kiểm soát sở hữu
 * theo số serial, phân trang, thống kê, và cơ chế fan-out thông báo (email/Zalo)
 * cho sự kiện mức cao. PrismaService và NotificationService giả lập.
 */
describe('RobotEventService', () => {
  let service: RobotEventService;
  let prisma: any;
  let notify: { notifyAlert: jest.Mock; notifyLowBattery: jest.Mock };

  const OWNER = 'owner-1';
  const OTHER = 'intruder-9';
  const robot = { id: 'r1', userId: OWNER, name: 'KPATROL-001', serialNumber: 'KPATROL-001' };

  beforeEach(async () => {
    prisma = {
      robot: { findUnique: jest.fn() },
      robotEvent: {
        create: jest.fn().mockResolvedValue({ id: 'e1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
    notify = {
      notifyAlert: jest.fn().mockResolvedValue(undefined),
      notifyLowBattery: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RobotEventService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notify },
      ],
    }).compile();

    service = module.get<RobotEventService>(RobotEventService);
  });

  afterEach(() => jest.clearAllMocks());

  it('được khởi tạo', () => expect(service).toBeDefined());

  describe('resolveOwnedRobot (qua createEvent)', () => {
    it('ném NotFound khi serial không tồn tại', async () => {
      prisma.robot.findUnique.mockResolvedValue(null);
      await expect(
        service.createEvent('KPATROL-X', OWNER, 'movement', 't', 'd'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
    it('ném Forbidden khi serial thuộc người khác', async () => {
      prisma.robot.findUnique.mockResolvedValue(robot);
      await expect(
        service.createEvent('KPATROL-001', OTHER, 'movement', 't', 'd'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('createEvent', () => {
    beforeEach(() => prisma.robot.findUnique.mockResolvedValue(robot));

    it('tạo bản ghi sự kiện gắn đúng robotId', async () => {
      await service.createEvent('KPATROL-001', OWNER, 'movement', 'Di chuyển', 'mô tả', 'info');
      const data = prisma.robotEvent.create.mock.calls[0][0].data;
      expect(data.robotId).toBe('r1');
      expect(data.eventType).toBe('movement');
      expect(data.severity).toBe('info');
    });

    it('fan-out notifyAlert khi severity = alert', async () => {
      await service.createEvent('KPATROL-001', OWNER, 'alert', 'Xâm nhập', 'phát hiện người', 'alert');
      await flush();
      expect(notify.notifyAlert).toHaveBeenCalledWith(OWNER, 'Xâm nhập', 'phát hiện người');
    });

    it('KHÔNG fan-out với severity info thường', async () => {
      await service.createEvent('KPATROL-001', OWNER, 'movement', 'x', 'y', 'info');
      await flush();
      expect(notify.notifyAlert).not.toHaveBeenCalled();
    });

    it('fan-out cảnh báo an ninh mức warning (eventType safety)', async () => {
      await service.createEvent('KPATROL-001', OWNER, 'safety', 'Vật cản', 'gần', 'warning');
      await flush();
      expect(notify.notifyAlert).toHaveBeenCalled();
    });

    it('gọi notifyLowBattery khi pin < 20%', async () => {
      await service.createEvent('KPATROL-001', OWNER, 'connection', 'Pin', 'thấp', 'info', { battery: 12 });
      await flush();
      expect(notify.notifyLowBattery).toHaveBeenCalledWith(OWNER, 'KPATROL-001', 12);
    });

    it('không gọi notifyLowBattery khi pin ≥ 20%', async () => {
      await service.createEvent('KPATROL-001', OWNER, 'connection', 'Pin', 'ổn', 'info', { battery: 80 });
      await flush();
      expect(notify.notifyLowBattery).not.toHaveBeenCalled();
    });
  });

  describe('getEvents', () => {
    beforeEach(() => prisma.robot.findUnique.mockResolvedValue(robot));

    it('tính skip theo trang và trả cấu trúc phân trang', async () => {
      prisma.robotEvent.findMany.mockResolvedValue([{ id: 'e1' }]);
      prisma.robotEvent.count.mockResolvedValue(120);
      const res = await service.getEvents('KPATROL-001', OWNER, 'all', 3, 50);
      expect(prisma.robotEvent.findMany.mock.calls[0][0].skip).toBe(100);
      expect(res).toMatchObject({ total: 120, page: 3, pageSize: 50, totalPages: 3 });
    });

    it("eventType 'all' không thêm bộ lọc loại", async () => {
      await service.getEvents('KPATROL-001', OWNER, 'all', 1, 50);
      const where = prisma.robotEvent.findMany.mock.calls[0][0].where;
      expect(where.eventType).toBeUndefined();
    });

    it('eventType cụ thể thêm bộ lọc', async () => {
      await service.getEvents('KPATROL-001', OWNER, 'alert', 1, 50);
      const where = prisma.robotEvent.findMany.mock.calls[0][0].where;
      expect(where.eventType).toBe('alert');
    });
  });

  describe('getStats / clearEvents / deleteEvent', () => {
    beforeEach(() => prisma.robot.findUnique.mockResolvedValue(robot));

    it('getStats trả các bộ đếm theo loại', async () => {
      prisma.robotEvent.count.mockResolvedValue(5);
      const res = await service.getStats('KPATROL-001', OWNER);
      expect(res).toHaveProperty('total');
      expect(res).toHaveProperty('movements');
      expect(res).toHaveProperty('alerts');
    });

    it('clearEvents xoá theo robotId', async () => {
      await service.clearEvents('KPATROL-001', OWNER);
      expect(prisma.robotEvent.deleteMany).toHaveBeenCalledWith({ where: { robotId: 'r1' } });
    });

    it('deleteEvent xoá theo id + robotId (chống xoá chéo robot)', async () => {
      await service.deleteEvent('e9', 'KPATROL-001', OWNER);
      expect(prisma.robotEvent.deleteMany).toHaveBeenCalledWith({ where: { id: 'e9', robotId: 'r1' } });
    });
  });
});
