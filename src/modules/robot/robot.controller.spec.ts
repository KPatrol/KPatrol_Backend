import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { RobotController } from './robot.controller';
import { RobotService } from './robot.service';
import { MqttIngestService } from '../mqtt-ingest/mqtt-ingest.service';

/**
 * Unit test cho RobotController — kiểm chứng mọi điểm cuối uỷ thác đúng cho
 * RobotService kèm req.user.id (kiểm soát sở hữu RBAC), và điểm cuối lịch đèn
 * có công bố MQTT retained. RobotService, JwtService, MqttIngestService giả lập.
 */
describe('RobotController', () => {
  let controller: RobotController;
  let robotService: any;
  let mqtt: any;
  const req = { user: { id: 'u1' } };

  beforeEach(async () => {
    robotService = {
      create: jest.fn().mockResolvedValue({}),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
      getRobotStats: jest.fn().mockResolvedValue({}),
      getConfig: jest.fn().mockResolvedValue({}),
      updateConfig: jest.fn().mockResolvedValue({}),
      updateLightSchedule: jest.fn().mockResolvedValue({
        serialNumber: 'KPATROL-001', enabled: true, start: '18:00', end: '06:00',
      }),
      getActiveAlerts: jest.fn().mockResolvedValue([]),
      acknowledgeAlert: jest.fn().mockResolvedValue({}),
      createPatrol: jest.fn().mockResolvedValue({}),
      listPatrols: jest.fn().mockResolvedValue([]),
      updatePatrolStatus: jest.fn().mockResolvedValue({}),
      deletePatrol: jest.fn().mockResolvedValue({}),
    };
    mqtt = { publishToRobot: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RobotController],
      providers: [
        { provide: RobotService, useValue: robotService },
        { provide: JwtService, useValue: {} },
        { provide: MqttIngestService, useValue: mqtt },
      ],
    }).compile();
    controller = module.get<RobotController>(RobotController);
  });

  afterEach(() => jest.clearAllMocks());

  it('create truyền (userId, dto)', () => {
    const dto = { name: 'R', serialNumber: 'KPATROL-001' };
    controller.create(req, dto as any);
    expect(robotService.create).toHaveBeenCalledWith('u1', dto);
  });

  it('findAll truyền userId', () => {
    controller.findAll(req);
    expect(robotService.findAll).toHaveBeenCalledWith('u1');
  });

  it('findOne truyền (id, userId)', () => {
    controller.findOne(req, 'r1');
    expect(robotService.findOne).toHaveBeenCalledWith('r1', 'u1');
  });

  it('update (PUT) truyền (id, userId, dto)', () => {
    const dto = { name: 'X' };
    controller.update(req, 'r1', dto as any);
    expect(robotService.update).toHaveBeenCalledWith('r1', 'u1', dto);
  });

  it('patch (PATCH) dùng chung logic update', () => {
    const dto = { name: 'Y' };
    controller.patch(req, 'r1', dto as any);
    expect(robotService.update).toHaveBeenCalledWith('r1', 'u1', dto);
  });

  it('remove truyền (id, userId)', () => {
    controller.remove(req, 'r1');
    expect(robotService.remove).toHaveBeenCalledWith('r1', 'u1');
  });

  it('getStats truyền (id, userId)', () => {
    controller.getStats(req, 'r1');
    expect(robotService.getRobotStats).toHaveBeenCalledWith('r1', 'u1');
  });

  it('getConfig truyền (id, userId)', () => {
    controller.getConfig(req, 'r1');
    expect(robotService.getConfig).toHaveBeenCalledWith('r1', 'u1');
  });

  it('updateConfig truyền (id, userId, dto)', () => {
    const dto = { defaultSpeed: 80 };
    controller.updateConfig(req, 'r1', dto as any);
    expect(robotService.updateConfig).toHaveBeenCalledWith('r1', 'u1', dto);
  });

  it('updateLightSchedule lưu lịch rồi công bố MQTT retained', async () => {
    const dto = { enabled: true, start: '18:00', end: '06:00' };
    const res = await controller.updateLightSchedule(req, 'r1', dto as any);
    expect(robotService.updateLightSchedule).toHaveBeenCalledWith('r1', 'u1', dto);
    expect(mqtt.publishToRobot).toHaveBeenCalledWith(
      'KPATROL-001',
      'light_schedule',
      expect.objectContaining({ enabled: true, start: '18:00', end: '06:00' }),
      { qos: 1, retain: true },
    );
    expect(res).toMatchObject({ ok: true, serialNumber: 'KPATROL-001' });
  });

  it('getAlerts truyền (id, userId)', () => {
    controller.getAlerts(req, 'r1');
    expect(robotService.getActiveAlerts).toHaveBeenCalledWith('r1', 'u1');
  });

  it('acknowledgeAlert truyền (alertId, userId)', () => {
    controller.acknowledgeAlert(req, 'a1');
    expect(robotService.acknowledgeAlert).toHaveBeenCalledWith('a1', 'u1');
  });

  it('createPatrol truyền name + cấu hình tuyến', () => {
    const dto = { name: 'Tuyến A', loop: true, steps: [{ x: 1 }] };
    controller.createPatrol(req, 'r1', dto as any);
    expect(robotService.createPatrol).toHaveBeenCalledWith('r1', 'u1', 'Tuyến A', {
      loop: true,
      steps: [{ x: 1 }],
    });
  });

  it('listPatrols truyền (id, userId)', () => {
    controller.listPatrols(req, 'r1');
    expect(robotService.listPatrols).toHaveBeenCalledWith('r1', 'u1');
  });

  it('updatePatrolStatus truyền (id, patrolId, userId, status)', () => {
    controller.updatePatrolStatus(req, 'r1', 'p1', { status: 'RUNNING' });
    expect(robotService.updatePatrolStatus).toHaveBeenCalledWith('r1', 'p1', 'u1', 'RUNNING');
  });

  it('deletePatrol truyền (id, patrolId, userId)', () => {
    controller.deletePatrol(req, 'r1', 'p1');
    expect(robotService.deletePatrol).toHaveBeenCalledWith('r1', 'p1', 'u1');
  });
});
