import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from './notification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailChannel } from './channels/email.channel';
import { ZaloChannel } from './channels/zalo.channel';

const flush = () => new Promise((r) => setImmediate(r));

/**
 * Unit test cho NotificationService — bản ghi hộp thư trong ứng dụng (luôn tạo
 * trước), và fan-out đa kênh (email/Zalo) tới chủ sở hữu + danh sách quản trị.
 * Prisma, hai kênh truyền và ConfigService được giả lập.
 */
describe('NotificationService', () => {
  let prisma: any;
  let email: any;
  let zalo: any;

  const USER = 'u1';

  function makeConfig(map: Record<string, string> = {}) {
    return { get: (k: string) => map[k] };
  }

  async function build(configMap: Record<string, string> = {}) {
    prisma = {
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'n1' }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ email: 'owner@kpatrol.vn' }) },
    };
    email = { id: 'email', isEnabled: jest.fn().mockReturnValue(true), send: jest.fn().mockResolvedValue(true) };
    zalo = { id: 'zalo', isEnabled: jest.fn().mockReturnValue(true), send: jest.fn().mockResolvedValue(true) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailChannel, useValue: email },
        { provide: ZaloChannel, useValue: zalo },
        { provide: ConfigService, useValue: makeConfig(configMap) },
      ],
    }).compile();
    return moduleRef.get<NotificationService>(NotificationService);
  }

  afterEach(() => jest.clearAllMocks());

  describe('CRUD hộp thư', () => {
    it('create lưu thông báo với type mặc định info', async () => {
      const svc = await build();
      await svc.create(USER, 'Tiêu đề', 'Nội dung');
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: { userId: USER, title: 'Tiêu đề', message: 'Nội dung', type: 'info' },
      });
    });

    it('findAll phân trang đúng (skip + totalPages)', async () => {
      const svc = await build();
      prisma.notification.count.mockResolvedValue(45);
      const res = await svc.findAll(USER, 2, 20);
      expect(prisma.notification.findMany.mock.calls[0][0].skip).toBe(20);
      expect(res).toMatchObject({ total: 45, page: 2, pageSize: 20, totalPages: 3 });
    });

    it('findUnread lọc read=false', async () => {
      const svc = await build();
      await svc.findUnread(USER);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER, read: false } }),
      );
    });

    it('countUnread đếm read=false', async () => {
      const svc = await build();
      await svc.countUnread(USER);
      expect(prisma.notification.count).toHaveBeenCalledWith({ where: { userId: USER, read: false } });
    });

    it('markAsRead chỉ tác động bản ghi của đúng người dùng', async () => {
      const svc = await build();
      await svc.markAsRead('n1', USER);
      const arg = prisma.notification.updateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'n1', userId: USER });
      expect(arg.data.read).toBe(true);
    });

    it('markAllAsRead đánh dấu mọi thông báo chưa đọc', async () => {
      const svc = await build();
      await svc.markAllAsRead(USER);
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: USER, read: false },
        data: { read: true, readAt: expect.any(Date) },
      });
    });

    it('delete xoá theo id + userId', async () => {
      const svc = await build();
      await svc.delete('n1', USER);
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { id: 'n1', userId: USER } });
    });

    it('deleteAll xoá toàn bộ của người dùng', async () => {
      const svc = await build();
      await svc.deleteAll(USER);
      expect(prisma.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
    });
  });

  describe('helper thông báo', () => {
    it('notifyRobotOnline tạo bản ghi type success', async () => {
      const svc = await build();
      await svc.notifyRobotOnline(USER, 'KPATROL-001');
      expect(prisma.notification.create.mock.calls[0][0].data.type).toBe('success');
    });

    it('notifyRobotOffline tạo bản ghi type warning', async () => {
      const svc = await build();
      await svc.notifyRobotOffline(USER, 'KPATROL-001');
      expect(prisma.notification.create.mock.calls[0][0].data.type).toBe('warning');
    });

    it('notifyPatrolComplete tạo bản ghi type info', async () => {
      const svc = await build();
      await svc.notifyPatrolComplete(USER, 'Tuyến A');
      expect(prisma.notification.create.mock.calls[0][0].data.type).toBe('info');
    });

    it('notifyLowBattery ≤15% là mức alert (critical)', async () => {
      const svc = await build();
      await svc.notifyLowBattery(USER, 'KPATROL-001', 12);
      expect(prisma.notification.create.mock.calls[0][0].data.type).toBe('alert');
    });

    it('notifyLowBattery >15% là mức warning', async () => {
      const svc = await build();
      await svc.notifyLowBattery(USER, 'KPATROL-001', 30);
      expect(prisma.notification.create.mock.calls[0][0].data.type).toBe('warning');
    });

    it('luôn tạo bản ghi DB trước khi fan-out (không phụ thuộc kênh truyền)', async () => {
      const svc = await build();
      const rec = await svc.notifyAlert(USER, 'fire', 'phát hiện lửa');
      expect(rec).toEqual({ id: 'n1' });
      expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('fan-out kênh truyền', () => {
    it('gửi email tới chủ sở hữu (tra cứu từ DB)', async () => {
      const svc = await build();
      await svc.notifyAlert(USER, 'fire', 'lửa');
      await flush();
      expect(prisma.user.findUnique).toHaveBeenCalled();
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@kpatrol.vn', severity: 'alert' }),
      );
    });

    it('broadcast tới danh sách quản trị khi cấu hình ALERT_RECIPIENTS_EMAIL', async () => {
      const svc = await build({ ALERT_RECIPIENTS_EMAIL: 'a@x.com,b@x.com' });
      await svc.notifyAlert(USER, 'fire', 'lửa');
      await flush();
      const tos = email.send.mock.calls.map((c: any[]) => c[0].to);
      expect(tos).toEqual(expect.arrayContaining(['a@x.com', 'b@x.com']));
    });

    it('NOTIFY_OWNER_EMAIL_OVERRIDE ghi đè địa chỉ chủ sở hữu (bỏ tra cứu DB)', async () => {
      const svc = await build({ NOTIFY_OWNER_EMAIL_OVERRIDE: 'demo@kpatrol.online' });
      await svc.notifyAlert(USER, 'fire', 'lửa');
      await flush();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'demo@kpatrol.online' }),
      );
    });

    it('không gửi qua kênh bị tắt (isEnabled=false)', async () => {
      const svc = await build();
      email.isEnabled.mockReturnValue(false);
      await svc.notifyAlert(USER, 'fire', 'lửa');
      await flush();
      expect(email.send).not.toHaveBeenCalled();
    });

    it('notifyForAlarmRule tôn trọng cờ notifyOwner=false (không gửi cho chủ)', async () => {
      const svc = await build();
      await svc.notifyForAlarmRule(USER, 'person', 'người', { notifyOwner: false });
      await flush();
      expect(email.send).not.toHaveBeenCalled();
      // vẫn tạo bản ghi hộp thư
      expect(prisma.notification.create).toHaveBeenCalled();
    });

    it('notifyForAlarmRule gửi tới email phụ (extraEmails)', async () => {
      const svc = await build();
      await svc.notifyForAlarmRule(USER, 'person', 'người', {
        notifyOwner: false,
        extraEmails: ['guard@site.vn'],
      });
      await flush();
      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'guard@site.vn' }));
    });
  });
});
