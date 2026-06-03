import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { AlarmRuleService } from './alarm-rule.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MqttIngestService } from '../mqtt-ingest/mqtt-ingest.service';

/**
 * Unit test cho AlarmRuleService — quản lý quy tắc cảnh báo do vận hành viên
 * cấu hình, kiểm soát sở hữu, và cơ chế tái công bố toàn bộ quy tắc lên MQTT
 * sau mỗi thao tác thêm/sửa/xoá. PrismaService và MqttIngestService giả lập.
 */
describe('AlarmRuleService', () => {
  let service: AlarmRuleService;
  let prisma: any;
  let mqtt: { publishAlarmRules: jest.Mock };

  const OWNER = 'owner-1';
  const OTHER = 'intruder-9';

  beforeEach(async () => {
    prisma = {
      robot: { findUnique: jest.fn() },
      alarmRule: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
      alarmTrigger: { findMany: jest.fn().mockResolvedValue([]) },
    };
    mqtt = { publishAlarmRules: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlarmRuleService,
        { provide: PrismaService, useValue: prisma },
        { provide: MqttIngestService, useValue: mqtt },
      ],
    }).compile();

    service = module.get<AlarmRuleService>(AlarmRuleService);
  });

  afterEach(() => jest.clearAllMocks());

  const ownRobot = () => prisma.robot.findUnique.mockResolvedValue({ userId: OWNER, serialNumber: 'KPATROL-001' });

  it('được khởi tạo', () => expect(service).toBeDefined());

  describe('assertOwnership (qua list)', () => {
    it('trả danh sách quy tắc khi đúng chủ', async () => {
      ownRobot();
      prisma.alarmRule.findMany.mockResolvedValue([{ id: 'rule1' }]);
      await expect(service.list('r1', OWNER)).resolves.toEqual([{ id: 'rule1' }]);
    });
    it('ném NotFound khi robot không tồn tại', async () => {
      prisma.robot.findUnique.mockResolvedValue(null);
      await expect(service.list('r1', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('ném Forbidden khi sai chủ', async () => {
      ownRobot();
      await expect(service.list('r1', OTHER)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('create', () => {
    it('áp giá trị mặc định khi DTO thiếu và tái công bố MQTT', async () => {
      ownRobot();
      prisma.alarmRule.create.mockResolvedValue({ id: 'rule1' });
      await service.create('r1', OWNER, { name: 'Cháy', eventType: 'fire' } as any);
      const data = prisma.alarmRule.create.mock.calls[0][0].data;
      expect(data.enabled).toBe(true);
      expect(data.continuousDurationS).toBe(15);
      expect(data.cooldownS).toBe(30);
      expect(data.lightPattern).toBe('WARN_BLINK');
      expect(data.buzzerPattern).toBe('ALARM');
      expect(data.notifyOwner).toBe(true);
      expect(mqtt.publishAlarmRules).toHaveBeenCalledTimes(1);
    });

    it('giữ giá trị do người dùng cung cấp', async () => {
      ownRobot();
      prisma.alarmRule.create.mockResolvedValue({ id: 'rule2' });
      await service.create('r1', OWNER, {
        name: 'Người', eventType: 'person', enabled: false, continuousDurationS: 5, cooldownS: 10,
      } as any);
      const data = prisma.alarmRule.create.mock.calls[0][0].data;
      expect(data.enabled).toBe(false);
      expect(data.continuousDurationS).toBe(5);
    });
  });

  describe('update', () => {
    it('ném NotFound khi quy tắc không tồn tại', async () => {
      ownRobot();
      prisma.alarmRule.findUnique.mockResolvedValue(null);
      await expect(service.update('r1', 'x', OWNER, {} as any)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('ném Forbidden khi quy tắc thuộc robot khác', async () => {
      ownRobot();
      prisma.alarmRule.findUnique.mockResolvedValue({ id: 'rule1', robotId: 'r-other' });
      await expect(service.update('r1', 'rule1', OWNER, {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    });
    it('chỉ cập nhật các trường được cung cấp + tái công bố', async () => {
      ownRobot();
      prisma.alarmRule.findUnique.mockResolvedValue({ id: 'rule1', robotId: 'r1' });
      prisma.alarmRule.update.mockResolvedValue({ id: 'rule1', enabled: false });
      await service.update('r1', 'rule1', OWNER, { enabled: false } as any);
      const data = prisma.alarmRule.update.mock.calls[0][0].data;
      expect(data).toEqual({ enabled: false });
      expect(mqtt.publishAlarmRules).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('ném NotFound khi không tồn tại', async () => {
      ownRobot();
      prisma.alarmRule.findUnique.mockResolvedValue(null);
      await expect(service.remove('r1', 'x', OWNER)).rejects.toBeInstanceOf(NotFoundException);
    });
    it('xoá + tái công bố khi hợp lệ', async () => {
      ownRobot();
      prisma.alarmRule.findUnique.mockResolvedValue({ id: 'rule1', robotId: 'r1' });
      prisma.alarmRule.delete.mockResolvedValue({ id: 'rule1' });
      await service.remove('r1', 'rule1', OWNER);
      expect(prisma.alarmRule.delete).toHaveBeenCalledWith({ where: { id: 'rule1' } });
      expect(mqtt.publishAlarmRules).toHaveBeenCalledTimes(1);
    });
  });

  describe('listTriggers', () => {
    it('giới hạn take tối đa 200', async () => {
      ownRobot();
      await service.listTriggers('r1', OWNER, 9999);
      expect(prisma.alarmTrigger.findMany.mock.calls[0][0].take).toBe(200);
    });
    it('giới hạn take tối thiểu 1', async () => {
      ownRobot();
      await service.listTriggers('r1', OWNER, 0);
      expect(prisma.alarmTrigger.findMany.mock.calls[0][0].take).toBe(1);
    });
  });

  describe('publishRulesForRobot', () => {
    it('không công bố khi không tìm thấy robot', async () => {
      prisma.robot.findUnique.mockResolvedValue(null);
      await service.publishRulesForRobot('r1');
      expect(mqtt.publishAlarmRules).not.toHaveBeenCalled();
    });
    it('chỉ công bố quy tắc enabled, đúng định dạng snake_case', async () => {
      prisma.robot.findUnique.mockResolvedValue({ serialNumber: 'KPATROL-001' });
      prisma.alarmRule.findMany.mockResolvedValue([
        { id: 'r1', name: 'Cháy', eventType: 'fire', enabled: true, continuousDurationS: 3, cooldownS: 30, lightPattern: 'WARN_BLINK', buzzerPattern: 'ALARM', windows: [] },
      ]);
      await service.publishRulesForRobot('rob1');
      expect(prisma.alarmRule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { robotId: 'rob1', enabled: true } }),
      );
      const [serial, payload] = mqtt.publishAlarmRules.mock.calls[0];
      expect(serial).toBe('KPATROL-001');
      expect(payload.rules[0]).toMatchObject({ event_type: 'fire', continuous_duration_s: 3, light_pattern: 'WARN_BLINK' });
    });
  });
});
