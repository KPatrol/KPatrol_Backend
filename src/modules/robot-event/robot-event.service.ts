import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class RobotEventService {
  private readonly log = new Logger(RobotEventService.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationService,
  ) {}

  /**
   * Resolve robot by serial AND verify the caller owns it. Replaces the
   * previous auto-provisioning path which was reachable from a public
   * endpoint and let any caller create rows under a shared `system@kpatrol.local`
   * admin user. After the 2026-05-15 lockdown, robot rows must already exist
   * (created via the authenticated /robots POST endpoint) and the JWT subject
   * must match `Robot.userId`.
   */
  private async resolveOwnedRobot(serialNumber: string, userId: string) {
    const robot = await this.prisma.robot.findUnique({ where: { serialNumber } });
    if (!robot) throw new NotFoundException(`Robot ${serialNumber} not found`);
    if (robot.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
    return robot;
  }

  /**
   * Log a new robot event (from frontend or Pi)
   */
  async createEvent(
    robotSerial: string,
    userId: string,
    eventType: string,
    title: string,
    description: string,
    severity: string = 'info',
    data?: any,
  ) {
    const robot = await this.resolveOwnedRobot(robotSerial, userId);

    const event = await this.prisma.robotEvent.create({
      data: {
        robotId: robot.id,
        eventType,
        title,
        description,
        severity,
        data: data ?? undefined,
      },
    });

    // Fan-out to email/Zalo channels for high-severity safety events. We
    // dispatch async (no await) so the HTTP/MQTT caller isn't blocked on SMTP.
    // Owner of the robot is the recipient; notifyAlert also broadcasts to the
    // admin list defined in ALERT_RECIPIENTS_*.
    void this.maybeFanOut(robot.userId, robot.name, eventType, title, description, severity, data);

    return event;
  }

  private async maybeFanOut(
    userId: string,
    robotName: string,
    eventType: string,
    title: string,
    description: string,
    severity: string,
    data?: any,
  ) {
    try {
      // Fan-out rules:
      //   - Always notify on severity 'alert' or 'error' (any eventType).
      //   - Notify on severity 'warning' only when the event is safety- or
      //     security-related (eventType 'safety' or 'alert'). This keeps low-
      //     confidence motion blips (severity='info', eventType='alert') and
      //     transient battery warnings outside the email/Zalo channel — they
      //     still land in the in-app inbox via the DB record above.
      const isHigh = severity === 'alert' || severity === 'error';
      const isSecurityWarning =
        severity === 'warning' && (eventType === 'safety' || eventType === 'alert');
      if (isHigh || isSecurityWarning) {
        await this.notifications.notifyAlert(userId, title, description);
      }

      // Battery events: trigger low-battery notification when payload carries a
      // numeric level under 20%. The mobile MQTTProvider posts these from the
      // T.BATTERY topic; firmware also emits them on critical thresholds.
      const level = extractBatteryLevel(data);
      if (level !== null && level < 20) {
        await this.notifications.notifyLowBattery(userId, robotName, level);
      }
    } catch (err) {
      this.log.warn(`fan-out failed for "${title}": ${(err as Error).message}`);
    }
  }

  /**
   * Get paginated robot events by serial number
   */
  async getEvents(
    robotSerial: string,
    userId: string,
    eventType?: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const robot = await this.resolveOwnedRobot(robotSerial, userId);
    const skip = (page - 1) * limit;

    const where: any = { robotId: robot.id };
    if (eventType && eventType !== 'all') {
      where.eventType = eventType;
    }

    const [events, total] = await Promise.all([
      this.prisma.robotEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.robotEvent.count({ where }),
    ]);

    return {
      items: events,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get event stats by serial number
   */
  async getStats(robotSerial: string, userId: string) {
    const robot = await this.resolveOwnedRobot(robotSerial, userId);

    const [total, movements, alerts, patrols, errors, connections] = await Promise.all([
      this.prisma.robotEvent.count({ where: { robotId: robot.id } }),
      this.prisma.robotEvent.count({ where: { robotId: robot.id, eventType: 'movement' } }),
      this.prisma.robotEvent.count({ where: { robotId: robot.id, eventType: 'alert' } }),
      this.prisma.robotEvent.count({ where: { robotId: robot.id, eventType: 'patrol' } }),
      this.prisma.robotEvent.count({ where: { robotId: robot.id, eventType: 'error' } }),
      this.prisma.robotEvent.count({ where: { robotId: robot.id, eventType: 'connection' } }),
    ]);

    return { total, movements, alerts, patrols, errors, connections };
  }

  /**
   * Clear all events for a robot
   */
  async clearEvents(robotSerial: string, userId: string) {
    const robot = await this.resolveOwnedRobot(robotSerial, userId);
    return this.prisma.robotEvent.deleteMany({
      where: { robotId: robot.id },
    });
  }

  /**
   * Delete a single event
   */
  async deleteEvent(id: string, robotSerial: string, userId: string) {
    const robot = await this.resolveOwnedRobot(robotSerial, userId);
    return this.prisma.robotEvent.deleteMany({
      where: { id, robotId: robot.id },
    });
  }
}

function extractBatteryLevel(data: any): number | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data.battery ?? data.level ?? data.batteryLevel ?? data.percent;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;
}
