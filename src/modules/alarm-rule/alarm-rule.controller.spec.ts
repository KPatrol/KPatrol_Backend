import { Test, TestingModule } from '@nestjs/testing';
import { AlarmRuleController } from './alarm-rule.controller';
import { AlarmRuleService } from './alarm-rule.service';

/**
 * Unit test cho AlarmRuleController — kiểm chứng uỷ thác đúng tham số (đặc biệt
 * là req.user.id cho kiểm soát sở hữu) và xử lý tham số limit. Service giả lập.
 */
describe('AlarmRuleController', () => {
  let controller: AlarmRuleController;
  let service: any;
  const req = { user: { id: 'u1' } };

  beforeEach(async () => {
    service = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
      listTriggers: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlarmRuleController],
      providers: [{ provide: AlarmRuleService, useValue: service }],
    }).compile();
    controller = module.get<AlarmRuleController>(AlarmRuleController);
  });

  afterEach(() => jest.clearAllMocks());

  it('vocabulary trả đủ ba nhóm enum cho PWA', () => {
    const v = controller.vocabulary();
    expect(v).toHaveProperty('eventTypes');
    expect(v).toHaveProperty('lightPatterns');
    expect(v).toHaveProperty('buzzerPatterns');
  });

  it('list truyền (id, userId)', () => {
    controller.list(req, 'r1');
    expect(service.list).toHaveBeenCalledWith('r1', 'u1');
  });

  it('create truyền (id, userId, dto)', () => {
    const dto = { name: 'Cháy', eventType: 'fire' };
    controller.create(req, 'r1', dto as any);
    expect(service.create).toHaveBeenCalledWith('r1', 'u1', dto);
  });

  it('update truyền (id, ruleId, userId, dto)', () => {
    const dto = { enabled: false };
    controller.update(req, 'r1', 'rule1', dto as any);
    expect(service.update).toHaveBeenCalledWith('r1', 'rule1', 'u1', dto);
  });

  it('remove truyền (id, ruleId, userId)', () => {
    controller.remove(req, 'r1', 'rule1');
    expect(service.remove).toHaveBeenCalledWith('r1', 'rule1', 'u1');
  });

  it('listTriggers phân tích limit dạng số', () => {
    controller.listTriggers(req, 'r1', '100');
    expect(service.listTriggers).toHaveBeenCalledWith('r1', 'u1', 100);
  });

  it('listTriggers mặc định 50 khi thiếu limit', () => {
    controller.listTriggers(req, 'r1', undefined);
    expect(service.listTriggers).toHaveBeenCalledWith('r1', 'u1', 50);
  });

  it('listTriggers mặc định 50 khi limit không phải số', () => {
    controller.listTriggers(req, 'r1', 'abc');
    expect(service.listTriggers).toHaveBeenCalledWith('r1', 'u1', 50);
  });
});
