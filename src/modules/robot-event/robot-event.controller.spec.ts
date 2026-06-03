import { Test, TestingModule } from '@nestjs/testing';
import { RobotEventController } from './robot-event.controller';
import { RobotEventService } from './robot-event.service';

/**
 * Unit test cho RobotEventController — uỷ thác đúng tham số cho service, gắn
 * req.user.id cho kiểm soát sở hữu, áp severity mặc định và phân tích page/limit.
 */
describe('RobotEventController', () => {
  let controller: RobotEventController;
  let service: any;
  const req = { user: { id: 'u1' } };

  beforeEach(async () => {
    service = {
      createEvent: jest.fn().mockResolvedValue({}),
      getEvents: jest.fn().mockResolvedValue({}),
      getStats: jest.fn().mockResolvedValue({}),
      clearEvents: jest.fn().mockResolvedValue({}),
      deleteEvent: jest.fn().mockResolvedValue({}),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RobotEventController],
      providers: [{ provide: RobotEventService, useValue: service }],
    }).compile();
    controller = module.get<RobotEventController>(RobotEventController);
  });

  afterEach(() => jest.clearAllMocks());

  it('create truyền đủ trường và userId từ JWT', () => {
    const dto = { robotSerial: 'KPATROL-001', eventType: 'alert', title: 'T', description: 'D', severity: 'alert', data: { x: 1 } };
    controller.create(req, dto as any);
    expect(service.createEvent).toHaveBeenCalledWith('KPATROL-001', 'u1', 'alert', 'T', 'D', 'alert', { x: 1 });
  });

  it('create áp severity mặc định info khi thiếu', () => {
    const dto = { robotSerial: 'KPATROL-001', eventType: 'movement', title: 'T', description: 'D' };
    controller.create(req, dto as any);
    expect(service.createEvent).toHaveBeenCalledWith('KPATROL-001', 'u1', 'movement', 'T', 'D', 'info', undefined);
  });

  it('getEvents phân tích page/limit sang số nguyên', () => {
    controller.getEvents(req, 'KPATROL-001', 'alert', '2', '25');
    expect(service.getEvents).toHaveBeenCalledWith('KPATROL-001', 'u1', 'alert', 2, 25);
  });

  it('getStats truyền (serial, userId)', () => {
    controller.getStats(req, 'KPATROL-001');
    expect(service.getStats).toHaveBeenCalledWith('KPATROL-001', 'u1');
  });

  it('clearAll truyền (serial, userId)', () => {
    controller.clearAll(req, 'KPATROL-001');
    expect(service.clearEvents).toHaveBeenCalledWith('KPATROL-001', 'u1');
  });

  it('deleteOne truyền (id, serial, userId)', () => {
    controller.deleteOne(req, 'e1', 'KPATROL-001');
    expect(service.deleteEvent).toHaveBeenCalledWith('e1', 'KPATROL-001', 'u1');
  });
});
