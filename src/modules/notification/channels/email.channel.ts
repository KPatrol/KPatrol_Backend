import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  NotificationChannel,
  NotificationPayload,
} from './notification-channel.interface';

/**
 * SMTP email channel. Reads config from env via ConfigService:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * If SMTP_HOST is missing the channel reports disabled and `send()` is a no-op.
 * This lets dev environments run without an SMTP server while production still
 * gets real emails when env is filled in.
 */
@Injectable()
export class EmailChannel implements NotificationChannel, OnModuleDestroy {
  readonly id = 'email';
  private readonly log = new Logger(EmailChannel.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) {
      this.log.warn('SMTP_HOST not set — email channel disabled');
      this.fromAddress = '';
      return;
    }
    const port = parseInt(this.config.get<string>('SMTP_PORT') ?? '587', 10);
    // SMTP_SECURE=true forces SMTPS (port 465). For 587 we use STARTTLS, which
    // nodemailer auto-negotiates when secure=false.
    const secure =
      (this.config.get<string>('SMTP_SECURE') ?? 'false').toLowerCase() ===
      'true';
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    this.fromAddress =
      this.config.get<string>('SMTP_FROM') ?? user ?? 'noreply@kpatrol.local';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });
    this.log.log(
      `SMTP configured: ${host}:${port} secure=${secure} from="${this.fromAddress}"`,
    );
  }

  isEnabled(): boolean {
    return this.transporter !== null;
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.transporter) return false;
    if (!payload.to || !payload.to.includes('@')) {
      // Don't waste an SMTP round-trip on obviously bad recipients — and
      // don't log the address at full level since it could be PII.
      this.log.debug(`skip send: invalid recipient`);
      return false;
    }
    try {
      await this.transporter.sendMail({
        from: this.fromAddress,
        to: payload.to,
        subject: `[K-Patrol] ${payload.subject}`,
        text: payload.body,
        html: this.renderHtml(payload),
      });
      return true;
    } catch (err) {
      this.log.error(
        `send failed to=${payload.to} subject="${payload.subject}": ${(err as Error).message}`,
      );
      return false;
    }
  }

  async onModuleDestroy() {
    this.transporter?.close();
  }

  private renderHtml(p: NotificationPayload): string {
    const colour = SEVERITY_COLOUR[p.severity ?? 'info'];
    const safeBody = escapeHtml(p.body).replace(/\n/g, '<br>');
    const safeSubject = escapeHtml(p.subject);
    return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;background:#f4f6f8;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e1e4e8;">
    <div style="background:${colour};color:#fff;padding:14px 20px;font-size:16px;font-weight:600;">
      K-Patrol · ${safeSubject}
    </div>
    <div style="padding:20px;color:#24292e;font-size:14px;line-height:1.6;">
      ${safeBody}
    </div>
    <div style="padding:12px 20px;background:#f6f8fa;color:#586069;font-size:12px;border-top:1px solid #e1e4e8;">
      Tin nhắn tự động từ hệ thống K-Patrol — không phản hồi vào địa chỉ này.
    </div>
  </div>
</body></html>`;
  }
}

const SEVERITY_COLOUR: Record<NonNullable<NotificationPayload['severity']>, string> = {
  info: '#0366d6',
  success: '#28a745',
  warning: '#f0ad4e',
  alert: '#d73a49',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
