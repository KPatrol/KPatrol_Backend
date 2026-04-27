import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RobotEventService {
  constructor(private prisma: PrismaService) {}

  /**
   * Find robot by serial, OR auto-create it with a system user.
   * This allows the frontend to log events without prior robot registration.
   */
  private async findRobotBySerial(serialNumber: string) {
    const existing = await this.prisma.robot.findUnique({ where: { serialNumber } });
    if (existing) return existing;

    // Auto-provision: ensure a system user exists
    const systemEmail = 'system@kpatrol.local';
    let systemUser = await this.prisma.user.findUnique({ where: { email: systemEmail } });
    if (!systemUser) {
      systemUser = await this.prisma.user.create({
        data: {
          email: systemEmail,
          password: await bcrypt.hash('kpatrol-system-internal', 10),
          name: 'K-Patrol System',
          role: 'ADMIN',
        },
      });
    }

    // Auto-create the robot
    return this.prisma.robot.create({
      data: {
        serialNumber,
        name: serialNumber,
        userId: systemUser.id,
        status: 'ONLINE',
      },
    });
  }

  /**
   * Log a new robot event (from frontend or Pi)
   */
  async createEvent(
    robotSerial: string,
    eventType: string,
    title: string,
    description: string,
    severity: string = 'info',
    data?: any,
  ) {
    const robot = await this.findRobotBySerial(robotSerial);

    return this.prisma.robotEvent.create({
      data: {
        robotId: robot.id,
        eventType,
        title,
        description,
        severity,
        data: data ?? undefined,
      },
    });
  }

  /**
   * Get paginated robot events by serial number
   */
  async getEvents(
    robotSerial: string,
    eventType?: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const robot = await this.findRobotBySerial(robotSerial);
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
  async getStats(robotSerial: string) {
    const robot = await this.findRobotBySerial(robotSerial);

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
  async clearEvents(robotSerial: string) {
    const robot = await this.findRobotBySerial(robotSerial);
    return this.prisma.robotEvent.deleteMany({
      where: { robotId: robot.id },
    });
  }

  /**
   * Delete a single event
   */
  async deleteEvent(id: string, robotSerial: string) {
    const robot = await this.findRobotBySerial(robotSerial);
    return this.prisma.robotEvent.deleteMany({
      where: { id, robotId: robot.id },
    });
  }
}
