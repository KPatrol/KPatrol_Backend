import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRobotDto, UpdateRobotDto } from './robot.dto';
import { RobotStatus } from '@prisma/client';

@Injectable()
export class RobotService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateRobotDto) {
    return this.prisma.robot.create({
      data: {
        ...dto,
        userId,
        status: RobotStatus.OFFLINE,
      },
    });
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

    return this.prisma.robot.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string, userId: string) {
    await this.findOne(id, userId); // Check ownership

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
    await this.prisma.session.updateMany({
      where: {
        robotId,
        endedAt: null,
      },
      data: {
        endedAt: new Date(),
      },
    });

    return this.prisma.session.create({
      data: {
        robotId,
        startedAt: new Date(),
      },
    });
  }

  async endSession(sessionId: string) {
    return this.prisma.session.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
      },
    });
  }

  // Patrol management
  async createPatrol(robotId: string, name: string, routeData?: any) {
    return this.prisma.patrol.create({
      data: {
        robotId,
        name,
        routeData,
        status: 'PENDING',
      },
    });
  }

  async updatePatrolStatus(patrolId: string, status: string) {
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

  // Alert management
  async createAlert(robotId: string, type: string, severity: string, message: string, data?: any) {
    return this.prisma.alert.create({
      data: {
        robotId,
        type,
        severity,
        message,
        data,
      },
    });
  }

  async acknowledgeAlert(alertId: string) {
    return this.prisma.alert.update({
      where: { id: alertId },
      data: {
        acknowledged: true,
        acknowledgedAt: new Date(),
      },
    });
  }

  async getActiveAlerts(robotId: string) {
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
      this.prisma.session.count({ where: { robotId } }),
      this.prisma.patrolLog.findMany({
        where: { patrol: { robotId } },
        take: 20,
        orderBy: { timestamp: 'desc' },
      }),
    ]);

    return {
      totalPatrols,
      totalAlerts,
      totalSessions,
      recentActivity,
    };
  }
}
