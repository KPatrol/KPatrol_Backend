import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationChannel,
  NotificationPayload,
} from './notification-channel.interface';

/**
 * Zalo Official Account "transaction message" channel.
 *
 * Endpoint: POST {ZALO_API_BASE}/message
 * Auth:    header `access_token: <ZALO_OA_TOKEN>`
 * Body:    { recipient: { user_id }, message: { text } }
 *
 * Zalo enforces a 24-hour interaction window for free-form text. For alert
 * notifications outside that window the OA must use a Zalo Notification
 * Service (ZNS) template — not implemented here, since template IDs are
 * deployment-specific. We log the failure and let the email fan-out cover it.
 *
 * The recipient `to` is a Zalo OA-scoped user_id (numeric string), NOT a phone
 * number. Subscribers obtain it by following the OA. Empty/invalid IDs are
 * skipped without an HTTP call.
 */
@Injectable()
export class ZaloChannel implements NotificationChannel {
  readonly id = 'zalo';
  private readonly log = new Logger(ZaloChannel.name);
  private readonly token: string | undefined;
  private readonly apiBase: string;

  constructor(private readonly config: ConfigService) {
    this.token = this.config.get<string>('ZALO_OA_TOKEN') || undefined;
    this.apiBase =
      this.config.get<string>('ZALO_API_BASE') ||
      'https://openapi.zalo.me/v3.0/oa';
    if (!this.token) {
      this.log.warn('ZALO_OA_TOKEN not set — Zalo channel disabled');
    } else {
      this.log.log(`Zalo OA channel ready (api=${this.apiBase})`);
    }
  }

  isEnabled(): boolean {
    return !!this.token;
  }

  async send(payload: NotificationPayload): Promise<boolean> {
    if (!this.token) return false;
    if (!payload.to || !/^\d+$/.test(payload.to)) {
      this.log.debug(`skip send: invalid Zalo user_id`);
      return false;
    }
    const text = `${payload.subject}\n\n${payload.body}`;
    // Zalo OA hard-caps at 2000 chars per message; truncate defensively.
    const truncated = text.length > 1900 ? text.slice(0, 1897) + '...' : text;
    try {
      const res = await fetch(`${this.apiBase}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: this.token,
        },
        body: JSON.stringify({
          recipient: { user_id: payload.to },
          message: { text: truncated },
        }),
        // Don't let a stuck OA endpoint hang the alert fan-out. 5s is plenty
        // for a single transactional message.
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.log.error(
          `send failed user=${payload.to} status=${res.status} ${res.statusText}`,
        );
        return false;
      }
      const json = (await res.json().catch(() => null)) as
        | { error?: number; message?: string }
        | null;
      if (json && typeof json.error === 'number' && json.error !== 0) {
        this.log.error(
          `Zalo error code=${json.error} message="${json.message}" user=${payload.to}`,
        );
        return false;
      }
      return true;
    } catch (err) {
      this.log.error(
        `send exception to=${payload.to}: ${(err as Error).message}`,
      );
      return false;
    }
  }
}
