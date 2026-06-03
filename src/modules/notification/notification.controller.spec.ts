import { Test, TestingModule } from '@nestjs/testing';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

/**
 * Unit test cho NotificationController — uỷ thác đúng tham số (kèm req.user.id),
 * phân tích page/limit, và điểm cuối test-send gửi thử qua pipeline thông báo.
 */
describe('NotificationController', () => {
  let controller: NotificationController;
  let service: any;
  const req = { user: { id: 'u1' } };

  beforeEach(async () => {
    service = {
      findAll: jest.fn().mockResolvedValue({}),
      findUnread: jest.fn().mockResolvedValue([]),
      countUnread: jest.fn().mockResolvedValue(0),
      markAsRead: jest.fn().mockResolvedValue({}),
      markAllAsRead: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteAll: jest.fn().mockResolvedValue({}),
      notifyForAlarmRule: jest.fn().mockResolvedValue({}),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [{ provide: NotificationService, useValue: service }],
    }).compile();
    controller = module.get<NotificationController>(NotificationController);
  });

  afterEach(() => jest.clearAllMocks());

  it('findAll phân tích page/limit sang số nguyên', () => {
    controller.findAll(req, '3', '15');
    expect(service.findAll).toHaveBeenCalledWith('u1', 3, 15);
  });

  it('findUnread truyền userId', () => {
    controller.findUnread(req);
    expect(service.findUnread).toHaveBeenCalledWith('u1');
  });

  it('countUnread truyền userId', () => {
    controller.countUnread(req);
    expect(service.countUnread).toHaveBeenCalledWith('u1');
  });

  it('markAsRead truyền (id, userId)', () => {
    controller.markAsRead(req, 'n1');
    expect(service.markAsRead).toHaveBeenCalledWith('n1', 'u1');
  });

  it('markAllAsRead truyền userId', () => {
    controller.markAllAsRead(req);
    expect(service.markAllAsRead).toHaveBeenCalledWith('u1');
  });

  it('delete truyền (id, userId)', () => {
    controller.delete(req, 'n1');
    expect(service.delete).toHaveBeenCalledWith('n1', 'u1');
  });

  it('deleteAll truyền userId', () => {
    controller.deleteAll(req);
    expect(service.deleteAll).toHaveBeenCalledWith('u1');
  });

  describe('testSend', () => {
    it('mặc định kind = fire khi không truyền', async () => {
      const res = await controller.testSend(req, {});
      expect(service.notifyForAlarmRule).toHaveBeenCalledWith(
        'u1', 'fire', expect.stringContaining('lửa'),
        expect.objectContaining({ notifyOwner: true, notifyAdmins: false }),
      );
      expect(res).toMatchObject({ ok: true, kind: 'fire' });
    });

    it('thêm email phụ khi extraEmail hợp lệ', async () => {
      await controller.testSend(req, { kind: 'person', extraEmail: 'x@y.vn' });
      const opts = service.notifyForAlarmRule.mock.calls[0][3];
      expect(opts.extraEmails).toEqual(['x@y.vn']);
    });

    it('bỏ qua extraEmail không hợp lệ (thiếu @)', async () => {
      await controller.testSend(req, { kind: 'motion', extraEmail: 'invalid' });
      const opts = service.notifyForAlarmRule.mock.calls[0][3];
      expect(opts.extraEmails).toEqual([]);
    });
  });
});
