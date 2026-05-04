/**
 * Notification channel abstraction.
 *
 * Each channel (Email, Zalo OA, push, SMS, ...) implements this interface so
 * NotificationService can fan-out a single alert to multiple channels without
 * caring about transport details. Channels are expected to be IDLE-safe: if
 * configuration is missing they should report `isEnabled() === false` and let
 * the service skip them silently rather than throwing on every call.
 */
export interface NotificationPayload {
  /** Recipient identifier — email address, Zalo user_id, FCM token, ... */
  to: string;
  /** Short subject (used as email subject / push title). */
  subject: string;
  /** Full message body. Plain text; channels may render their own format. */
  body: string;
  /** Severity hint — channels may colour or filter on this. */
  severity?: 'info' | 'success' | 'warning' | 'alert';
  /** Optional structured context (robotId, alertType, ...) for templates. */
  context?: Record<string, unknown>;
}

export interface NotificationChannel {
  /** Stable channel id used for logging and selection ("email", "zalo", ...). */
  readonly id: string;

  /** True when the channel has all required config and is ready to send. */
  isEnabled(): boolean;

  /**
   * Best-effort delivery. Implementations MUST NOT throw — return `false` on
   * any failure so a single broken channel cannot abort the fan-out chain.
   */
  send(payload: NotificationPayload): Promise<boolean>;
}
