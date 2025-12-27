import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, title: string, message: string, type: string = 'info') {
    return this.prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type,
      },
    });
  }

  async findAll(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);

    return {
      items: notifications,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findUnread(userId: string) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        read: false,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countUnread(userId: string) {
    return this.prisma.notification.count({
      where: {
        userId,
        read: false,
      },
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        id,
        userId,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });
  }

  async delete(id: string, userId: string) {
    return this.prisma.notification.deleteMany({
      where: {
        id,
        userId,
      },
    });
  }

  async deleteAll(userId: string) {
    return this.prisma.notification.deleteMany({
      where: { userId },
    });
  }

  // Helper methods for common notification types
  async notifyRobotOnline(userId: string, robotName: string) {
    return this.create(
      userId,
      'Robot Online',
      `${robotName} is now online and ready`,
      'success',
    );
  }

  async notifyRobotOffline(userId: string, robotName: string) {
    return this.create(
      userId,
      'Robot Offline',
      `${robotName} has disconnected`,
      'warning',
    );
  }

  async notifyAlert(userId: string, alertType: string, message: string) {
    return this.create(userId, `Alert: ${alertType}`, message, 'alert');
  }

  async notifyPatrolComplete(userId: string, patrolName: string) {
    return this.create(
      userId,
      'Patrol Complete',
      `Patrol "${patrolName}" has been completed successfully`,
      'info',
    );
  }

  async notifyLowBattery(userId: string, robotName: string, level: number) {
    return this.create(
      userId,
      'Low Battery Warning',
      `${robotName} battery is at ${level}%`,
      'warning',
    );
  }
}
