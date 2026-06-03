import { Test, TestingModule } from '@nestjs/testing';
import { MaintenanceService } from './maintenance.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Unit test cho MaintenanceService — các tác vụ dọn dẹp định kỳ (cron): xoá
 * telemetry > 7 ngày, phiên hết hạn, sự kiện > 30 ngày, cảnh báo đã xác nhận
 * > 14 ngày. Kiểm chứng mốc thời gian cắt và việc nuốt lỗi (không ném ra).
 */
describe('MaintenanceService', () => {
  let service: MaintenanceService;
  let prisma: any;

  const daysAgo = (n: number) => Date.now() - n * 86_400_000;
  const within = (d: Date, ms: number, tol = 60_000) => Math.abs(d.getTime() - ms) < tol;

  beforeEach(async () => {
    prisma = {
      telemetry: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
      authSession: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      robotEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
      alert: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [MaintenanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<MaintenanceService>(MaintenanceService);
  });

  afterEach(() => jest.clearAllMocks());

  it('cleanupTelemetry xoá bản ghi cũ hơn 7 ngày', async () => {
    await service.cleanupTelemetry();
    const where = prisma.telemetry.deleteMany.mock.calls[0][0].where;
    expect(within(where.timestamp.lt, daysAgo(7))).toBe(true);
  });

  it('cleanupExpiredSessions xoá phiên đã hết hạn (lt now)', async () => {
    await service.cleanupExpiredSessions();
    const where = prisma.authSession.deleteMany.mock.calls[0][0].where;
    expect(within(where.expiresAt.lt, Date.now())).toBe(true);
  });

  it('cleanupOldEvents xoá sự kiện cũ hơn 30 ngày', async () => {
    await service.cleanupOldEvents();
    const where = prisma.robotEvent.deleteMany.mock.calls[0][0].where;
    expect(within(where.createdAt.lt, daysAgo(30))).toBe(true);
  });

  it('cleanupAcknowledgedAlerts chỉ xoá cảnh báo đã xác nhận cũ hơn 14 ngày', async () => {
    await service.cleanupAcknowledgedAlerts();
    const where = prisma.alert.deleteMany.mock.calls[0][0].where;
    expect(where.acknowledged).toBe(true);
    expect(within(where.createdAt.lt, daysAgo(14))).toBe(true);
  });

  it('nuốt lỗi DB ở cleanupTelemetry (không ném ra ngoài)', async () => {
    prisma.telemetry.deleteMany.mockRejectedValue(new Error('db down'));
    await expect(service.cleanupTelemetry()).resolves.toBeUndefined();
  });

  it('nuốt lỗi DB ở cleanupExpiredSessions', async () => {
    prisma.authSession.deleteMany.mockRejectedValue(new Error('db down'));
    await expect(service.cleanupExpiredSessions()).resolves.toBeUndefined();
  });

  it('nuốt lỗi DB ở cleanupOldEvents', async () => {
    prisma.robotEvent.deleteMany.mockRejectedValue(new Error('db down'));
    await expect(service.cleanupOldEvents()).resolves.toBeUndefined();
  });

  it('nuốt lỗi DB ở cleanupAcknowledgedAlerts', async () => {
    prisma.alert.deleteMany.mockRejectedValue(new Error('db down'));
    await expect(service.cleanupAcknowledgedAlerts()).resolves.toBeUndefined();
  });
});
