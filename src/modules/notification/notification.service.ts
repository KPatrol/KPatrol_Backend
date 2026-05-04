import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailChannel } from './channels/email.channel';
import { ZaloChannel } from './channels/zalo.channel';
import { NotificationPayload } from './channels/notification-channel.interface';

type Severity = NotificationPayload['severity'];

@Injectable()
export class NotificationService {
  private readonly log = new Logger(NotificationService.name);
  private readonly adminEmails: string[];
  private readonly adminZaloIds: string[];

  constructor(
    private prisma: PrismaService,
    private email: EmailChannel,
    private zalo: ZaloChannel,
    private config: ConfigService,
  ) {
    this.adminEmails = parseList(
      this.config.get<string>('ALERT_RECIPIENTS_EMAIL'),
    );
    this.adminZaloIds = parseList(
      this.config.get<string>('ALERT_RECIPIENTS_ZALO'),
    );
    if (this.adminEmails.length || this.adminZaloIds.length) {
      this.log.log(
        `admin broadcast: emails=${this.adminEmails.length} zalo=${this.adminZaloIds.length}`,
      );
    }
  }

  async create(
    userId: string,
    title: string,
    message: string,
    type: string = 'info',
  ) {
    return this.prisma.notification.create({
      data: { userId, title, message, type },
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
      where: { userId, read: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countUnread(userId: string) {
    return this.prisma.notification.count({
      where: { userId, read: false },
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
  }

  async delete(id: string, userId: string) {
    return this.prisma.notification.deleteMany({ where: { id, userId } });
  }

  async deleteAll(userId: string) {
    return this.prisma.notification.deleteMany({ where: { userId } });
  }

  // ============================================================
  // Helper methods — DB record + side-channel fan-out.
  // ============================================================

  async notifyRobotOnline(userId: string, robotName: string) {
    return this.dispatch(userId, {
      title: 'Robot Online',
      body: `${robotName} đã trực tuyến và sẵn sàng làm việc.`,
      type: 'success',
    });
  }

  async notifyRobotOffline(userId: string, robotName: string) {
    return this.dispatch(userId, {
      title: 'Robot Offline',
      body: `${robotName} đã mất kết nối với hệ thống.`,
      type: 'warning',
    });
  }

  /**
   * High-severity event (tip-over, ToF emergency, intrusion, fire detection,
   * battery critical). Always fans out to admin broadcast list in addition to
   * the owning user.
   */
  async notifyAlert(userId: string, alertType: string, message: string) {
    return this.dispatch(userId, {
      title: `Alert: ${alertType}`,
      body: message,
      type: 'alert',
      broadcastAdmins: true,
    });
  }

  async notifyPatrolComplete(userId: string, patrolName: string) {
    return this.dispatch(userId, {
      title: 'Patrol Complete',
      body: `Lộ trình tuần tra "${patrolName}" đã hoàn tất.`,
      type: 'info',
    });
  }

  async notifyLowBattery(userId: string, robotName: string, level: number) {
    const critical = level <= 15;
    return this.dispatch(userId, {
      title: critical ? 'Critical Battery' : 'Low Battery Warning',
      body: `${robotName} pin còn ${level}%${critical ? ' — cần sạc ngay' : ''}.`,
      type: critical ? 'alert' : 'warning',
      broadcastAdmins: critical,
    });
  }

  // ============================================================
  // Internals
  // ============================================================

  private async dispatch(
    userId: string,
    opts: {
      title: string;
      body: string;
      type: string;
      broadcastAdmins?: boolean;
    },
  ) {
    // Always create the DB record first — UI inbox + audit trail must not
    // depend on transport channels succeeding.
    const record = await this.create(userId, opts.title, opts.body, opts.type);

    // Fire transport channels in parallel without awaiting in the request
    // path — the caller (HTTP handler / MQTT consumer) shouldn't wait for
    // SMTP latency. Errors are absorbed by each channel's try/catch.
    void this.fanOut(userId, opts);
    return record;
  }

  private async fanOut(
    userId: string,
    opts: { title: string; body: string; type: string; broadcastAdmins?: boolean },
  ) {
    const severity = (opts.type as Severity) ?? 'info';
    const recipients: { kind: 'email' | 'zalo'; to: string }[] = [];

    // Owning user — email lookup. (Zalo user_id is not in the User model yet,
    // so per-user Zalo delivery only happens via admin broadcast for now.)
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (user?.email) recipients.push({ kind: 'email', to: user.email });
    } catch (err) {
      this.log.warn(`user lookup failed for fan-out: ${(err as Error).message}`);
    }

    if (opts.broadcastAdmins) {
      for (const a of this.adminEmails) recipients.push({ kind: 'email', to: a });
      for (const z of this.adminZaloIds) recipients.push({ kind: 'zalo', to: z });
    }

    if (!recipients.length) return;

    const payloadBase = {
      subject: opts.title,
      body: opts.body,
      severity,
    } as const;

    await Promise.all(
      recipients.map(async (r) => {
        const channel = r.kind === 'email' ? this.email : this.zalo;
        if (!channel.isEnabled()) return;
        const ok = await channel.send({ ...payloadBase, to: r.to });
        if (!ok) {
          this.log.warn(
            `fan-out ${channel.id} → ${maskRecipient(r.to)} failed for "${opts.title}"`,
          );
        }
      }),
    );
  }
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function maskRecipient(to: string): string {
  // Don't dump full PII into logs; keep enough to debug routing.
  if (to.includes('@')) {
    const [name, domain] = to.split('@');
    const head = name.slice(0, 2);
    return `${head}***@${domain}`;
  }
  if (to.length <= 4) return '***';
  return to.slice(0, 2) + '***' + to.slice(-2);
}
