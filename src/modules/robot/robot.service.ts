import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRobotDto, UpdateRobotDto } from './robot.dto';
import { RobotStatus, AlertType, AlertSeverity, Prisma } from '@prisma/client';

// V5.8: Hot-path ownership cache for the joystick forward endpoint.
// `forwardCommand` runs at 10-20 Hz; the cold `findOne()` join (10× sessions
// + 10× patrols + 10× alerts) is wasted work just to confirm the JWT user
// owns the robot. We keep a small per-process LRU mapping `userId:robotId`
// → `{serialNumber}` with a 60-second TTL so the steady-state cost of a
// joystick frame is one in-process Map.get() instead of four PostgreSQL
// SELECTs. Cache entry size is tiny; capping at ~256 entries comfortably
// covers any realistic operator count.
type OwnershipCacheEntry = { serialNumber: string; expiresAt: number };
const OWNERSHIP_TTL_MS = 60_000;
const OWNERSHIP_MAX_ENTRIES = 256;

@Injectable()
export class RobotService {
  private readonly ownershipCache = new Map<string, OwnershipCacheEntry>();

  constructor(private prisma: PrismaService) {}

  /**
   * Hot-path ownership check used by /robots/:id/forward/:suffix.
   * Returns the robot's serialNumber (the only field the MQTT publish
   * needs) and caches the answer for 60 s. The cold {@link findOne}
   * remains the canonical detail loader; this is purely an optimisation
   * for the joystick command stream.
   *
   * Throws NotFoundException if the robot doesn't exist, ForbiddenException
   * if it belongs to another user — same contract as findOne, so callers
   * can swap one for the other.
   */
  async findOneForCommand(id: string, userId: string): Promise<{ serialNumber: string }> {
    const cacheKey = `${userId}:${id}`;
    const now = Date.now();
    const hit = this.ownershipCache.get(cacheKey);
    if (hit && hit.expiresAt > now) {
      return { serialNumber: hit.serialNumber };
    }
    const robot = await this.prisma.robot.findUnique({
      where: { id },
      select: { id: true, userId: true, serialNumber: true },
    });
    if (!robot) {
      throw new NotFoundException('Robot not found');
    }
    if (robot.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    if (this.ownershipCache.size >= OWNERSHIP_MAX_ENTRIES) {
      // Cheap eviction — drop the oldest insertion order entry. Map keeps
      // insertion order so the first key from the iterator is fine.
      const firstKey = this.ownershipCache.keys().next().value;
      if (firstKey !== undefined) this.ownershipCache.delete(firstKey);
    }
    this.ownershipCache.set(cacheKey, {
      serialNumber: robot.serialNumber,
      expiresAt: now + OWNERSHIP_TTL_MS,
    });
    return { serialNumber: robot.serialNumber };
  }

  /** Invalidate any cached ownership entry for `robotId` — call from update/
   *  delete so a transferred or renamed robot doesn't continue accepting
   *  commands under the previous owner's session. */
  invalidateOwnershipCache(robotId: string): void {
    for (const key of this.ownershipCache.keys()) {
      if (key.endsWith(`:${robotId}`)) {
        this.ownershipCache.delete(key);
      }
    }
  }

  async create(userId: string, dto: CreateRobotDto) {
    try {
      return await this.prisma.robot.create({
        data: {
          name: dto.name,
          serialNumber: dto.serialNumber ?? `KPATROL-${Date.now()}`,
          userId,
          status: RobotStatus.OFFLINE,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `Mã serial "${dto.serialNumber}" đã được đăng ký. Vui lòng dùng mã khác.`,
        );
      }
      throw err;
    }
  }

  async findAll(userId: string) {
    return this.prisma.robot.findMany({
      where: { userId },
      include: {
        sessions: {
          take: 1,
          orderBy: { startedAt: 'desc' },
        },
        _count: {
          select: { patrols: true, alerts: true },
        },
      },
    });
  }

  async findOne(id: string, userId: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id },
      include: {
        sessions: {
          take: 10,
          orderBy: { startedAt: 'desc' },
        },
        patrols: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        alerts: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!robot) {
      throw new NotFoundException('Robot not found');
    }

    if (robot.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }

    return robot;
  }

  async update(id: string, userId: string, dto: UpdateRobotDto) {
    await this.findOne(id, userId); // Check ownership
    this.invalidateOwnershipCache(id);

    return this.prisma.robot.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId); // Check ownership
    this.invalidateOwnershipCache(id);

    return this.prisma.robot.delete({
      where: { id },
    });
  }

  async updateStatus(id: string, status: RobotStatus) {
    return this.prisma.robot.update({
      where: { id },
      data: {
        status,
        lastSeen: new Date(),
      },
    });
  }

  async updateBatteryLevel(id: string, batteryLevel: number) {
    return this.prisma.robot.update({
      where: { id },
      data: { batteryLevel },
    });
  }

  // Session management
  async startSession(robotId: string) {
    // End any existing active session
    await this.prisma.robotSession.updateMany({
      where: {
        robotId,
        endedAt: null,
      },
      data: {
        endedAt: new Date(),
      },
    });

    return this.prisma.robotSession.create({
      data: {
        robotId,
        startedAt: new Date(),
      },
    });
  }

  async endSession(sessionId: string) {
    return this.prisma.robotSession.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
      },
    });
  }

  // Patrol management
  async createPatrol(robotId: string, userId: string, name: string, routeData?: any) {
    await this.findOne(robotId, userId); // Check ownership
    return this.prisma.patrol.create({
      data: {
        robotId,
        name,
        routeData,
        status: 'PENDING',
      },
    });
  }

  async listPatrols(robotId: string, userId: string) {
    await this.findOne(robotId, userId); // Check ownership
    return this.prisma.patrol.findMany({
      where: { robotId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { logs: true } },
        logs: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    });
  }

  private async assertPatrolOwnership(robotId: string, patrolId: string, userId: string) {
    await this.findOne(robotId, userId); // verifies robot belongs to user
    const patrol = await this.prisma.patrol.findUnique({ where: { id: patrolId } });
    if (!patrol) throw new NotFoundException('Patrol not found');
    if (patrol.robotId !== robotId) {
      throw new ForbiddenException('Patrol does not belong to this robot');
    }
    return patrol;
  }

  async deletePatrol(robotId: string, patrolId: string, userId: string) {
    await this.assertPatrolOwnership(robotId, patrolId, userId);
    return this.prisma.patrol.delete({ where: { id: patrolId } });
  }

  async updatePatrolStatus(robotId: string, patrolId: string, userId: string, status: string) {
    await this.assertPatrolOwnership(robotId, patrolId, userId);
    return this.prisma.patrol.update({
      where: { id: patrolId },
      data: { status },
    });
  }

  async addPatrolLog(patrolId: string, logType: string, message: string, data?: any) {
    return this.prisma.patrolLog.create({
      data: {
        patrolId,
        logType,
        message,
        data,
      },
    });
  }

  /**
   * Lightweight ownership check used by the socket gateway at handshake time.
   * Avoids the heavy joins that `findOne` pulls in; only selects userId.
   * Throws ForbiddenException (or NotFoundException) on mismatch.
   */
  async assertOwnership(robotId: string, userId: string): Promise<void> {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { userId: true },
    });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.userId !== userId) throw new ForbiddenException('Access denied');
  }

  /**
   * Check whether the patrol belongs to the given robot. Used by the socket
   * gateway to reject `robot:patrol:log` events that try to write logs to
   * patrols owned by another robot (spoofed patrolId protection).
   */
  async patrolBelongsToRobot(patrolId: string, robotId: string): Promise<boolean> {
    const patrol = await this.prisma.patrol.findUnique({
      where: { id: patrolId },
      select: { robotId: true },
    });
    return patrol?.robotId === robotId;
  }

  // Alert management
  async createAlert(robotId: string, type: string, severity: string, message: string, data?: any) {
    return this.prisma.alert.create({
      data: {
        robotId,
        type: type as AlertType,
        severity: (severity ?? 'INFO') as AlertSeverity,
        message,
        data,
      },
    });
  }

  async acknowledgeAlert(alertId: string, userId: string) {
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      include: { robot: { select: { userId: true } } },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    if (alert.robot.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return this.prisma.alert.update({
      where: { id: alertId },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date(),
      },
    });
  }

  async getActiveAlerts(robotId: string, userId: string) {
    await this.findOne(robotId, userId); // Check ownership
    return this.prisma.alert.findMany({
      where: {
        robotId,
        acknowledged: false,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Statistics
  async getRobotStats(robotId: string, userId: string) {
    await this.findOne(robotId, userId); // Check ownership

    const [totalPatrols, totalAlerts, totalSessions, recentActivity] = await Promise.all([
      this.prisma.patrol.count({ where: { robotId } }),
      this.prisma.alert.count({ where: { robotId } }),
      this.prisma.robotSession.count({ where: { robotId } }),
      this.prisma.patrolLog.findMany({
        where: { patrol: { robotId } },
        take: 20,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      totalPatrols,
      totalAlerts,
      totalSessions,
      recentActivity,
    };
  }

  // Update robot config / settings
  async updateConfig(id: string, userId: string, config: {
    safetyEnabled?: boolean;
    dangerDistance?: number;
    cautionDistance?: number;
    slowDistance?: number;
    defaultSpeed?: number;
    name?: string;
  }) {
    await this.findOne(id, userId); // Check ownership
    return this.prisma.robot.update({
      where: { id },
      data: config,
    });
  }

  async getConfig(id: string, userId: string) {
    const robot = await this.prisma.robot.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        name: true,
        serialNumber: true,
        safetyEnabled: true,
        dangerDistance: true,
        cautionDistance: true,
        slowDistance: true,
        defaultSpeed: true,
        status: true,
        batteryLevel: true,
        lastSeen: true,
        mainLightScheduleEnabled: true,
        mainLightScheduleStart: true,
        mainLightScheduleEnd: true,
      },
    });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.userId !== userId) throw new ForbiddenException('Access denied');
    const { userId: _ownerId, ...safe } = robot;
    return safe;
  }

  /**
   * V5.15c15 (2026-05-27): persist the operator-defined daily auto-on
   * schedule for the main lamp and return the serial so the controller
   * can fan it out to the Pi via the existing publishToRobot path.
   * Times come in as "HH:MM" 24-hour strings. Pass null/null with
   * enabled:false to disable.
   */
  async updateLightSchedule(
    id: string,
    userId: string,
    dto: { enabled: boolean; start?: string | null; end?: string | null },
  ): Promise<{ serialNumber: string; enabled: boolean; start: string | null; end: string | null }> {
    await this.findOne(id, userId); // ownership + existence
    const HM_RE = /^\d{2}:\d{2}$/;
    const start = dto.enabled ? (dto.start ?? null) : null;
    const end = dto.enabled ? (dto.end ?? null) : null;
    if (dto.enabled) {
      if (!start || !HM_RE.test(start)) throw new ForbiddenException('start must be HH:MM');
      if (!end || !HM_RE.test(end)) throw new ForbiddenException('end must be HH:MM');
    }
    const updated = await this.prisma.robot.update({
      where: { id },
      data: {
        mainLightScheduleEnabled: dto.enabled,
        mainLightScheduleStart: start,
        mainLightScheduleEnd: end,
      },
      select: {
        serialNumber: true,
        mainLightScheduleEnabled: true,
        mainLightScheduleStart: true,
        mainLightScheduleEnd: true,
      },
    });
    return {
      serialNumber: updated.serialNumber,
      enabled: updated.mainLightScheduleEnabled,
      start: updated.mainLightScheduleStart,
      end: updated.mainLightScheduleEnd,
    };
  }
}
