import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as path from 'path';
import * as fs from 'fs';
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
  // Resolved at boot. Empty when the bundled logo file is missing so
  // sendMail() can skip the attachments[] entry rather than throwing.
  private readonly logoPath: string;
  // Public-facing cockpit URL surfaced in the "Mở Cockpit" CTA button.
  // Falls back to localhost so local dev emails are still clickable.
  private readonly cockpitUrl: string;

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
    // Logo bundled at /app/assets/logo.png by the Dockerfile. In dev (npm
    // start) we fall back to <repo>/backend/assets/logo.png. Empty string
    // tells `send()` to skip the attachments entry.
    const candidates = [
      path.resolve('/app/assets/logo.png'),
      path.resolve(__dirname, '../../../../assets/logo.png'),
      path.resolve(process.cwd(), 'assets/logo.png'),
    ];
    this.logoPath = candidates.find((p) => fs.existsSync(p)) ?? '';
    this.cockpitUrl =
      this.config.get<string>('PUBLIC_COCKPIT_URL') ??
      'http://localhost:8001';
    this.log.log(
      `SMTP configured: ${host}:${port} secure=${secure} from="${this.fromAddress}" logo=${this.logoPath ? 'embedded' : 'missing'}`,
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
      const attachments: nodemailer.SendMailOptions['attachments'] = this.logoPath
        ? [{ filename: 'logo.png', path: this.logoPath, cid: 'kpatrol-logo' }]
        : [];
      const info = await this.transporter.sendMail({
        from: this.fromAddress,
        to: payload.to,
        subject: `[K-Patrol] ${payload.subject}`,
        text: this.renderText(payload),
        html: this.renderHtml(payload),
        attachments,
      });
      // Log success so the operator can confirm delivery from container
      // logs without checking the recipient inbox. Mask the recipient.
      const masked =
        payload.to.replace(/(.{2}).*(@.*)/, '$1***$2');
      this.log.log(
        `sent to=${masked} subject="${payload.subject}" id=${info?.messageId ?? '?'}`,
      );
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

  /** Plain-text fallback for clients that strip HTML. */
  private renderText(p: NotificationPayload): string {
    const ts = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    return [
      `K-PATROL · ${SEVERITY_LABEL_VI[p.severity ?? 'info']}`,
      '',
      p.subject,
      '',
      p.body,
      '',
      `Thời gian: ${ts}`,
      `Cockpit: ${this.cockpitUrl}`,
      '',
      'Tin nhắn tự động từ hệ thống K-Patrol — vui lòng không phản hồi.',
    ].join('\n');
  }

  /**
   * Mobile-friendly Vietnamese HTML email. Bulletproof table layout (no
   * flex/grid) so Gmail / Outlook / Apple Mail render identically. Dark
   * theme matches the cockpit UI — emerald/amber/red severity strip plus
   * a cyan CTA button that lands in the operator's PWA.
   */
  private renderHtml(p: NotificationPayload): string {
    const severity = p.severity ?? 'info';
    const colour = SEVERITY_COLOUR[severity];
    const bgTint = SEVERITY_BG_TINT[severity];
    const labelVi = SEVERITY_LABEL_VI[severity];
    const safeBody = escapeHtml(p.body).replace(/\n/g, '<br>');
    const safeSubject = escapeHtml(p.subject);
    const ts = escapeHtml(
      new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    );
    const logoTag = this.logoPath
      ? `<img src="cid:kpatrol-logo" width="48" height="48" alt="K-Patrol" style="display:block;border-radius:10px;background:#0f172a;"/>`
      // Inline SVG fallback when the bundled logo file is missing.
      : `<div style="width:48px;height:48px;background:linear-gradient(135deg,#22d3ee 0%,#0891b2 100%);border-radius:10px;display:inline-block;text-align:center;line-height:48px;color:#0a0f1a;font-weight:900;font-size:22px;font-family:Arial,sans-serif;">K</div>`;

    return `<!DOCTYPE html>
<html lang="vi"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:24px 12px;background:#020617;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;">

    <!-- Header: gradient banner with brand logo -->
    <tr>
      <td style="background:linear-gradient(135deg,#0a0f1a 0%,#0f172a 60%,#1e293b 100%);padding:28px 28px 22px;border-radius:16px 16px 0 0;border:1px solid #1e293b;border-bottom:none;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td valign="middle" width="60" style="padding-right:14px;">${logoTag}</td>
            <td valign="middle">
              <div style="color:#22d3ee;font-size:10px;font-weight:900;letter-spacing:4px;text-transform:uppercase;">K-Patrol · Cảnh báo AI</div>
              <div style="color:#ffffff;font-size:18px;font-weight:800;margin-top:6px;line-height:1.3;">${safeSubject}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Severity strip -->
    <tr>
      <td style="background:${bgTint};padding:10px 28px;border-left:1px solid #1e293b;border-right:1px solid #1e293b;border-top:3px solid ${colour};">
        <span style="color:${colour};font-size:11px;font-weight:900;letter-spacing:3px;text-transform:uppercase;">● ${labelVi}</span>
        <span style="color:#64748b;font-size:11px;margin-left:12px;font-family:'SF Mono',Consolas,monospace;">${ts}</span>
      </td>
    </tr>

    <!-- Body card -->
    <tr>
      <td style="background:#0f172a;padding:26px 28px 18px;color:#e2e8f0;font-size:15px;line-height:1.7;border-left:1px solid #1e293b;border-right:1px solid #1e293b;">
        ${safeBody}
      </td>
    </tr>

    <!-- CTA -->
    <tr>
      <td style="background:#0f172a;padding:0 28px 28px;border-left:1px solid #1e293b;border-right:1px solid #1e293b;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="border-radius:10px;background:linear-gradient(135deg,#22d3ee 0%,#0891b2 100%);box-shadow:0 4px 14px rgba(34,211,238,0.3);">
              <a href="${escapeHtml(this.cockpitUrl)}" target="_blank" style="display:inline-block;padding:13px 26px;color:#0a0f1a;text-decoration:none;font-weight:800;font-size:13px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,sans-serif;">
                Mở Cockpit →
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background:#020617;color:#475569;padding:18px 28px 20px;font-size:11px;line-height:1.6;border-radius:0 0 16px 16px;border:1px solid #1e293b;border-top:none;">
        <div style="color:#64748b;font-weight:700;letter-spacing:1px;text-transform:uppercase;font-size:10px;margin-bottom:4px;">Robot tuần tra K-Patrol</div>
        Đồ án tốt nghiệp 2026 · Vũ Đăng Khoa · Đại học Phenikaa
        <br/><span style="color:#334155;">Tin nhắn tự động — vui lòng không phản hồi vào địa chỉ này.</span>
      </td>
    </tr>

  </table>
</body></html>`;
  }
}

const SEVERITY_COLOUR: Record<NonNullable<NotificationPayload['severity']>, string> = {
  info: '#22d3ee',     // cyan
  success: '#34d399',  // emerald
  warning: '#fbbf24',  // amber
  alert: '#f87171',    // red
};

// Faint background tint behind the severity strip — same hue at very low
// alpha so the strip reads as a single coloured banner.
const SEVERITY_BG_TINT: Record<NonNullable<NotificationPayload['severity']>, string> = {
  info: '#0c1f2b',
  success: '#0c241d',
  warning: '#241c0c',
  alert: '#2b1212',
};

const SEVERITY_LABEL_VI: Record<NonNullable<NotificationPayload['severity']>, string> = {
  info: 'Thông tin',
  success: 'Hoàn tất',
  warning: 'Cảnh báo',
  alert: 'Khẩn cấp',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
