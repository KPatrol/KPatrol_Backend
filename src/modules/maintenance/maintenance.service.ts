import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Clean up old telemetry data — runs every day at 3:00 AM
   * Keeps last 7 days of detailed telemetry, deletes older records
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupTelemetry() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7);

    try {
      const result = await this.prisma.telemetry.deleteMany({
        where: {
          timestamp: { lt: cutoffDate },
        },
      });
      this.logger.log(`Telemetry cleanup: removed ${result.count} records older than 7 days`);
    } catch (error) {
      this.logger.error('Telemetry cleanup failed:', error);
    }
  }

  /**
   * Clean up expired auth sessions — runs every 6 hours
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async cleanupExpiredSessions() {
    try {
      const result = await this.prisma.authSession.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });
      if (result.count > 0) {
        this.logger.log(`Session cleanup: removed ${result.count} expired sessions`);
      }
    } catch (error) {
      this.logger.error('Session cleanup failed:', error);
    }
  }

  /**
   * Clean up old robot events — runs every day at 4:00 AM
   * Keeps last 30 days of events
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cleanupOldEvents() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 30);

    try {
      const result = await this.prisma.robotEvent.deleteMany({
        where: {
          createdAt: { lt: cutoffDate },
        },
      });
      if (result.count > 0) {
        this.logger.log(`Event cleanup: removed ${result.count} events older than 30 days`);
      }
    } catch (error) {
      this.logger.error('Event cleanup failed:', error);
    }
  }

  /**
   * Clean up acknowledged alerts older than 14 days — runs daily at 4:30 AM
   */
  @Cron('0 30 4 * * *')
  async cleanupAcknowledgedAlerts() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 14);

    try {
      const result = await this.prisma.alert.deleteMany({
        where: {
          acknowledged: true,
          createdAt: { lt: cutoffDate },
        },
      });
      if (result.count > 0) {
        this.logger.log(`Alert cleanup: removed ${result.count} acknowledged alerts older than 14 days`);
      }
    } catch (error) {
      this.logger.error('Alert cleanup failed:', error);
    }
  }
}
