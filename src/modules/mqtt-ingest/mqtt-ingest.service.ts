import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import * as mqtt from 'mqtt';
import { Prisma, AlertSeverity, AlertType, RobotStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';
import { AlarmRuleService } from '../alarm-rule/alarm-rule.service';
import { NotificationService } from '../notification/notification.service';

/**
 * Payload published by robots/pi-controller/detection/alert_bridge.py.
 *
 *   {
 *     "id":          <robot-local SQLite row id>,
 *     "kind":        "person" | "fire",
 *     "confidence":  0.0–1.0,
 *     "bbox":        [x, y, w, h],
 *     "ts":          unix seconds,
 *     "snapshot":    "<robot-local filesystem path, informational>",
 *     "robot":       "<serial number — also encoded in topic>",
 *     "frame_size":  [width, height],
 *     "snapshot_b64": "<optional base64 JPEG>"
 *   }
 *
 * Subscribed topic: kpatrol/+/alert
 */
interface DetectionAlertPayload {
  id: number;
  kind: string;
  confidence: number;
  bbox: number[];
  ts: number;
  snapshot?: string;
  robot?: string;
  frame_size?: number[];
  snapshot_b64?: string;
}

const KIND_TO_ALERT_TYPE: Record<string, AlertType> = {
  person: AlertType.PERSON_DETECTED,
  fire: AlertType.FIRE_DETECTED,
  motion: AlertType.MOTION_DETECTED,
};

const KIND_TO_SEVERITY: Record<string, AlertSeverity> = {
  person: AlertSeverity.WARNING,
  fire: AlertSeverity.CRITICAL,
  motion: AlertSeverity.INFO,
};

const KIND_TO_MESSAGE_VI: Record<string, string> = {
  person: 'Phát hiện người trong khu vực tuần tra',
  fire: 'Cảnh báo: phát hiện lửa/khói',
  motion: 'Phát hiện chuyển động bất thường',
};

/**
 * Per-robot ingest cache. Heartbeat at 5s + status at 2s + safety at 5 Hz would
 * be ~8 writes/second/robot if we persisted every payload — way more than the
 * dashboard needs. We persist on transitions (online↔offline, battery delta)
 * and on a slow heartbeat cadence so `Robot.lastSeen` stays accurate.
 */
interface RobotIngestState {
  userId: string;
  lastDbHeartbeat: number; // wall-clock ms of last DB write for this robot
  lastStatus: RobotStatus; // last status we persisted
  lastBatteryPct: number | null; // last battery we persisted
}

const HEARTBEAT_DB_WRITE_MS = 10_000; // throttle Robot.lastSeen writes
const BATTERY_DB_DELTA_PCT = 1.0; // ignore <1% battery jitter
// Defense-in-depth offline detection. If we haven't seen a Pi heartbeat in
// this many ms we flip the robot to OFFLINE ourselves — covers cases where
// the broker's LWT doesn't fire (broker restart, retained message lost,
// network partition between broker and backend).
const STALE_OFFLINE_MS = 30_000;
const STALE_SCAN_INTERVAL_MS = 5_000;
// Heartbeats are produced by the Pi controller — accept only payloads whose
// clientId carries the Pi prefix. Browsers historically also published into
// this topic which kept robots stuck ONLINE; rejecting those is the fix.
const PI_CLIENT_ID_PREFIX = 'kpatrol_pi_';

@Injectable()
export class MqttIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MqttIngestService');
  private client: mqtt.MqttClient | null = null;
  private readonly topicPrefix: string;
  private readonly enabled: boolean;
  // Keyed by robotId — populated on first message per robot. Lets us debounce
  // DB writes and emit user-scoped `robot:status:changed` only on transitions.
  private readonly robotState = new Map<string, RobotIngestState>();
  private staleScanTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly socket: SocketGateway,
    // Cyclic with AlarmRuleModule because that module's republish flow needs
    // this service to publish on the broker. forwardRef breaks construction
    // ordering while preserving Nest's DI graph at runtime.
    @Inject(forwardRef(() => AlarmRuleService))
    private readonly alarmRules: AlarmRuleService,
    private readonly notifications: NotificationService,
  ) {
    this.topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'kpatrol';
    // Soft-disable when MQTT_HOST is empty so dev environments (and CI) don't
    // fight a missing broker. Production deploys must set MQTT_HOST.
    this.enabled = Boolean(process.env.MQTT_HOST);
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        'MQTT_HOST not set — detection ingest disabled. ' +
          'Set MQTT_HOST/MQTT_PORT/MQTT_USERNAME/MQTT_PASSWORD to enable.',
      );
      return;
    }
    // Hydrate the in-memory cache from the DB so the stale-scan timer can
    // demote robots that were ONLINE before this process started but stop
    // emitting heartbeats afterwards (e.g. backend restart while Pi is off).
    await this.hydrateRobotState();
    this.connect();
    this.staleScanTimer = setInterval(
      () => void this.scanStaleRobots(),
      STALE_SCAN_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.staleScanTimer) {
      clearInterval(this.staleScanTimer);
      this.staleScanTimer = null;
    }
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
  }

  private async hydrateRobotState(): Promise<void> {
    try {
      const rows = await this.prisma.robot.findMany({
        select: {
          id: true,
          userId: true,
          status: true,
          lastSeen: true,
          batteryLevel: true,
        },
      });
      for (const row of rows) {
        this.robotState.set(row.id, {
          userId: row.userId,
          lastDbHeartbeat: row.lastSeen ? row.lastSeen.getTime() : 0,
          lastStatus: row.status,
          lastBatteryPct: row.batteryLevel ?? null,
        });
      }
    } catch (err) {
      this.logger.warn(
        `hydrateRobotState failed: ${(err as Error).message}`,
      );
    }
  }

  private async scanStaleRobots(): Promise<void> {
    const now = Date.now();
    for (const [robotId, state] of this.robotState) {
      if (state.lastStatus !== RobotStatus.ONLINE) continue;
      if (now - state.lastDbHeartbeat < STALE_OFFLINE_MS) continue;
      try {
        await this.prisma.robot.update({
          where: { id: robotId },
          data: { status: RobotStatus.OFFLINE },
        });
        state.lastStatus = RobotStatus.OFFLINE;
        this.socket.broadcastUserRobotStatusChanged(state.userId, {
          robotId,
          status: RobotStatus.OFFLINE,
          lastSeen: new Date(state.lastDbHeartbeat).toISOString(),
        });
        this.logger.warn(
          `robot ${robotId} marked OFFLINE — no heartbeat for ${Math.round((now - state.lastDbHeartbeat) / 1000)}s`,
        );
      } catch (err) {
        this.logger.warn(
          `stale-offline update failed for ${robotId}: ${(err as Error).message}`,
        );
      }
    }
  }

  private connect(): void {
    const host = process.env.MQTT_HOST!;
    const port = Number(process.env.MQTT_PORT || 1883);
    const protocol = (process.env.MQTT_PROTOCOL || 'mqtt') as
      | 'mqtt'
      | 'mqtts'
      | 'ws'
      | 'wss';
    const username = process.env.MQTT_USERNAME;
    const password = process.env.MQTT_PASSWORD;
    const clientId = `kpatrol-backend-${Math.random().toString(16).slice(2, 10)}`;

    const url = `${protocol}://${host}:${port}`;
    this.logger.log(`Connecting to ${url} as ${clientId}`);

    this.client = mqtt.connect(url, {
      clientId,
      username,
      password,
      clean: true,
      // Long enough that brief broker restarts don't churn the session, short
      // enough that a dead node is reaped before alerts pile up at the broker.
      keepalive: 30,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
    });

    // Topics consumed off the broker. `alert` writes a row + broadcasts;
    // heartbeat/status/safety bridge Pi telemetry into Socket.IO so the PWA
    // doesn't need its own browser-side MQTT WS client (which is flakey
    // behind proxies). Heartbeat also doubles as the LWT channel — Pi sets
    // a retained `{"status":"offline"}` will on this topic.
    const subscriptions: Array<[string, mqtt.IClientSubscribeOptions]> = [
      [`${this.topicPrefix}/+/alert`, { qos: 1 }],
      [`${this.topicPrefix}/+/heartbeat`, { qos: 1 }],
      [`${this.topicPrefix}/+/status`, { qos: 0 }],
      [`${this.topicPrefix}/+/safety`, { qos: 0 }],
      // V11: operator-configurable alarms. `alarm/triggered` is forensic — Pi
      // publishes once per fire so QoS=1 to survive backend restarts. Battery
      // arrives ~1 Hz from the INA219/ADC fallback; QoS=0 is fine, we only
      // persist on ≥1% delta anyway.
      [`${this.topicPrefix}/+/alarm/triggered`, { qos: 1 }],
      [`${this.topicPrefix}/+/battery`, { qos: 0 }],
      // V5.6: D1 R32 peripheral hub state (relay + DHT + watchdog).
      // QoS=0 is fine — Pi publishes retained=true so reconnect picks up
      // the latest snapshot automatically.
      [`${this.topicPrefix}/+/peripherals/state`, { qos: 0 }],
    ];

    this.client.on('connect', () => {
      this.logger.log(
        `MQTT connected — subscribing to ${subscriptions.map(([t]) => t).join(', ')}`,
      );
      for (const [topic, opts] of subscriptions) {
        this.client!.subscribe(topic, opts, (err) => {
          if (err) {
            this.logger.error(`subscribe ${topic} failed: ${err.message}`);
          }
        });
      }
      // Republish retained alarm rules for every robot. The Pi side subscribes
      // to `alarm/rules` with retained=true so a power-cycled robot picks the
      // operator's latest rule set up immediately. If the broker was restarted
      // (retained state lost) this is how rules come back without UI churn.
      void this.hydrateAlarmRules();
    });

    this.client.on('reconnect', () => {
      this.logger.warn('MQTT reconnect attempt');
    });

    this.client.on('error', (err) => {
      // mqtt.js emits OSError-like errors when broker is down; library will
      // keep retrying via reconnectPeriod, so just log and let it work.
      this.logger.error(`MQTT error: ${err.message}`);
    });

    this.client.on('message', (recvTopic, payload) => {
      void this.handleMessage(recvTopic, payload);
    });
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    const parsed = this.parseTopic(topic);
    if (!parsed) {
      this.logger.warn(`ignored message: cannot parse topic ${topic}`);
      return;
    }
    const { serial, suffix } = parsed;

    let body: any;
    try {
      body = JSON.parse(payload.toString('utf8'));
    } catch (err) {
      this.logger.warn(
        `ignored ${topic}: invalid JSON (${(err as Error).message})`,
      );
      return;
    }

    // Resolve once per message — heartbeat/safety/status all need {id, userId}
    // to fan out via Socket.IO rooms.
    const robot = await this.prisma.robot.findUnique({
      where: { serialNumber: serial },
      select: { id: true, userId: true },
    });
    if (!robot) {
      // Unknown robot: don't auto-create — operator may not have registered
      // it yet. Log so the situation is visible (debounce per-serial would
      // be nicer but the ack only happens once on startup).
      this.logger.warn(
        `ignored ${topic}: robot serial ${serial} not registered`,
      );
      return;
    }

    switch (suffix) {
      case 'alert':
        await this.handleAlertMessage(topic, robot, body as DetectionAlertPayload);
        return;
      case 'heartbeat':
        await this.handleHeartbeatMessage(robot, body);
        return;
      case 'status':
        await this.handleStatusMessage(robot, body);
        return;
      case 'safety':
        this.handleSafetyMessage(robot, body);
        return;
      case 'alarm/triggered':
        await this.handleAlarmTriggeredMessage(robot, body);
        return;
      case 'battery':
        await this.handleBatteryMessage(robot, body);
        return;
      case 'peripherals/state':
        this.handlePeripheralStateMessage(robot, body);
        return;
      default:
        this.logger.warn(`ignored ${topic}: unknown suffix "${suffix}"`);
    }
  }

  private async handleAlertMessage(
    topic: string,
    robot: { id: string; userId: string },
    body: DetectionAlertPayload,
  ): Promise<void> {
    if (
      typeof body?.kind !== 'string' ||
      typeof body?.confidence !== 'number'
    ) {
      this.logger.warn(`ignored ${topic}: missing kind/confidence`);
      return;
    }

    const alertType = KIND_TO_ALERT_TYPE[body.kind];
    if (!alertType) {
      this.logger.warn(`ignored ${topic}: unknown kind "${body.kind}"`);
      return;
    }

    const bbox = Array.isArray(body.bbox) ? body.bbox : [];
    const frameSize = Array.isArray(body.frame_size) ? body.frame_size : [];
    const severity = KIND_TO_SEVERITY[body.kind] ?? AlertSeverity.WARNING;
    const message =
      KIND_TO_MESSAGE_VI[body.kind] ?? `Detection alert: ${body.kind}`;

    try {
      // Upsert by (robotId, externalId): if the robot's drainer retries the
      // same row after a broker reconnect, we keep one Alert row instead of
      // dozens. Conflict path is a no-op to preserve the original createdAt.
      const alert = await this.prisma.alert.upsert({
        where: {
          robotId_externalId: {
            robotId: robot.id,
            externalId: typeof body.id === 'number' ? body.id : 0,
          },
        },
        create: {
          robotId: robot.id,
          type: alertType,
          severity,
          message,
          confidence: body.confidence,
          bboxX: bbox[0] ?? null,
          bboxY: bbox[1] ?? null,
          bboxW: bbox[2] ?? null,
          bboxH: bbox[3] ?? null,
          frameWidth: frameSize[0] ?? null,
          frameHeight: frameSize[1] ?? null,
          snapshotB64: body.snapshot_b64 ?? null,
          externalId: typeof body.id === 'number' ? body.id : null,
          // Mirror the unstructured fields into `data` for ad-hoc queries.
          data: {
            kind: body.kind,
            snapshot: body.snapshot,
            ts: body.ts,
          } as Prisma.InputJsonValue,
        },
        update: {},
      });

      this.logger.log(
        `alert id=${alert.id} robot=${robot.id} kind=${body.kind} conf=${body.confidence.toFixed(2)}`,
      );

      // Live push to operator UI. Strip snapshot_b64 from the broadcast — at
      // ~6–10 KB per frame the bandwidth hit on a dozen idle web clients is
      // noticeable. The web UI fetches the full row via REST when needed.
      const { snapshotB64: _omit, ...broadcastFields } = alert;
      this.socket.broadcastDetectionAlert(robot.id, broadcastFields);
    } catch (err) {
      this.logger.error(
        `persist failed for ${topic}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private parseTopic(topic: string): { serial: string; suffix: string } | null {
    // topic = "<prefix>/<serial>/<suffix...>". Suffix can have one or two
    // segments (e.g. "alert", "heartbeat", "alarm/triggered"). We rejoin the
    // tail so the suffix-switch downstream only has to compare a single key.
    const parts = topic.split('/');
    if (parts.length < 3) return null;
    if (parts[0] !== this.topicPrefix) return null;
    const serial = parts[1];
    const suffix = parts.slice(2).join('/');
    if (!serial || !suffix) return null;
    return { serial, suffix };
  }

  /**
   * Heartbeat handler. Pi publishes a retained heartbeat every 5s plus a
   * retained `{"status":"offline"}` LWT on disconnect. We persist transitions
   * (online↔offline) immediately and throttle online-online refreshes to
   * `HEARTBEAT_DB_WRITE_MS` so a 5s cadence isn't a write storm at scale.
   */
  private async handleHeartbeatMessage(
    robot: { id: string; userId: string },
    body: any,
  ): Promise<void> {
    // Reject heartbeats that didn't originate from the Pi controller. Web
    // clients used to publish into this topic, which kept robots pinned
    // ONLINE indefinitely even after the Pi powered off.
    const clientId = typeof body?.clientId === 'string' ? body.clientId : '';
    if (clientId && !clientId.startsWith(PI_CLIENT_ID_PREFIX)) {
      this.logger.warn(
        `ignored heartbeat for ${robot.id}: clientId "${clientId}" is not a Pi controller`,
      );
      return;
    }
    const rawStatus = typeof body?.status === 'string' ? body.status : 'online';
    const newStatus: RobotStatus =
      rawStatus === 'offline' ? RobotStatus.OFFLINE : RobotStatus.ONLINE;
    const now = Date.now();
    const cached = this.robotState.get(robot.id);
    const statusChanged = !cached || cached.lastStatus !== newStatus;
    const heartbeatStale =
      !cached || now - cached.lastDbHeartbeat >= HEARTBEAT_DB_WRITE_MS;

    if (statusChanged || heartbeatStale) {
      try {
        await this.prisma.robot.update({
          where: { id: robot.id },
          data: { status: newStatus, lastSeen: new Date() },
        });
      } catch (err) {
        this.logger.warn(
          `heartbeat persist failed for ${robot.id}: ${(err as Error).message}`,
        );
      }
      this.robotState.set(robot.id, {
        userId: robot.userId,
        lastDbHeartbeat: now,
        lastStatus: newStatus,
        lastBatteryPct: cached?.lastBatteryPct ?? null,
      });
    }

    // Always re-broadcast the raw heartbeat so the per-robot view gets the
    // freshest controller flags (esp32_motor, esp32_encoder, nav_mode, ...).
    this.socket.broadcastRobotHeartbeat(robot.id, body);

    // Status-changed event drives the /robots listing card without forcing
    // every row to hold a per-robot socket. Scoped to the owner's user room.
    if (statusChanged) {
      this.socket.broadcastUserRobotStatusChanged(robot.userId, {
        robotId: robot.id,
        status: newStatus,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  /**
   * Status handler. Pi pushes connection/battery/speed/light/temperature at
   * 2 Hz. Treated as proof-of-life: every arrival refreshes lastSeen (throttled
   * to HEARTBEAT_DB_WRITE_MS) and flips the robot to ONLINE on transition, so
   * the dashboard recovers from an OFFLINE state even when the Pi's heartbeat
   * topic is silent (e.g. the broker hasn't redelivered the retained payload
   * yet, but status frames are streaming). Battery is persisted independently
   * on ≥1% delta to avoid write storms.
   */
  private async handleStatusMessage(
    robot: { id: string; userId: string },
    body: any,
  ): Promise<void> {
    this.socket.broadcastRobotStatus(robot.id, body);

    const now = Date.now();
    const cached = this.robotState.get(robot.id);
    const battery = typeof body?.battery === 'number' ? body.battery : null;

    const statusChanged = !cached || cached.lastStatus !== RobotStatus.ONLINE;
    const heartbeatStale =
      !cached || now - cached.lastDbHeartbeat >= HEARTBEAT_DB_WRITE_MS;
    const prevPct = cached?.lastBatteryPct ?? null;
    const batteryChanged =
      battery !== null &&
      (prevPct === null || Math.abs(battery - prevPct) >= BATTERY_DB_DELTA_PCT);

    if (!statusChanged && !heartbeatStale && !batteryChanged) {
      return;
    }

    const data: { status?: RobotStatus; lastSeen?: Date; batteryLevel?: number } = {};
    if (statusChanged) data.status = RobotStatus.ONLINE;
    if (statusChanged || heartbeatStale) data.lastSeen = new Date();
    if (batteryChanged && battery !== null) data.batteryLevel = battery;

    try {
      await this.prisma.robot.update({ where: { id: robot.id }, data });
    } catch (err) {
      this.logger.warn(
        `status persist failed for ${robot.id}: ${(err as Error).message}`,
      );
      return;
    }

    this.robotState.set(robot.id, {
      userId: robot.userId,
      lastDbHeartbeat:
        statusChanged || heartbeatStale ? now : cached?.lastDbHeartbeat ?? now,
      lastStatus: RobotStatus.ONLINE,
      lastBatteryPct: batteryChanged && battery !== null ? battery : prevPct,
    });

    if (statusChanged) {
      this.socket.broadcastUserRobotStatusChanged(robot.userId, {
        robotId: robot.id,
        status: RobotStatus.ONLINE,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  /**
   * Safety handler. Pi publishes at 5 Hz — too fast for DB writes, so this
   * is fan-out-only into the robot's Socket.IO room. The safety panel on
   * the PWA listens for `robot:safety` and renders directly.
   */
  private handleSafetyMessage(
    robot: { id: string; userId: string },
    body: any,
  ): void {
    this.socket.broadcastRobotSafety(robot.id, body);
  }

  /**
   * Alarm fire handler. Pi publishes on `kpatrol/{serial}/alarm/triggered`
   * once per rule fire. Payload shape (see safety/alarm_controller.py):
   *
   *   {
   *     "rule_id":        "<cuid from backend, may be empty if rule local-only>",
   *     "rule_name":      "<operator label>",
   *     "event_type":     "person" | "fire" | "battery_low" | ...,
   *     "light_pattern":  "WARN_BLINK" | ...,
   *     "buzzer_pattern": "ALARM" | ...,
   *     "dwell_s":        <float seconds the event was continuously observed>,
   *     "ts":             <unix seconds>,
   *     "meta":           <optional dict — confidence, distance, etc.>
   *   }
   *
   * We never auto-resolve missing rule_id back to an AlarmRule row; if the
   * operator deleted the rule between fire and ingest we still keep the row
   * for forensics (ruleId nullable + onDelete:SetNull).
   */
  private async handleAlarmTriggeredMessage(
    robot: { id: string; userId: string },
    body: any,
  ): Promise<void> {
    if (
      typeof body?.rule_name !== 'string' ||
      typeof body?.event_type !== 'string'
    ) {
      this.logger.warn(
        `ignored alarm/triggered for ${robot.id}: missing rule_name/event_type`,
      );
      return;
    }

    const ruleId =
      typeof body.rule_id === 'string' && body.rule_id.length > 0
        ? body.rule_id
        : null;

    // Validate that the rule still exists before binding; otherwise leave
    // ruleId null. The FK is nullable so this preserves the trigger row.
    // V5.15c9: also pull notification flags so we can fan out without a
    // second DB round-trip after persisting the trigger.
    let resolvedRuleId: string | null = null;
    let ruleName: string | null = null;
    let notifyConfig: {
      notifyOwner: boolean;
      notifyAdmins: boolean;
      notifyEmail: string | null;
      notifyZaloIds: unknown;
    } | null = null;
    if (ruleId) {
      const rule = await this.prisma.alarmRule.findUnique({
        where: { id: ruleId },
        select: {
          id: true,
          robotId: true,
          name: true,
          notifyOwner: true,
          notifyAdmins: true,
          notifyEmail: true,
          notifyZaloIds: true,
        },
      });
      if (rule && rule.robotId === robot.id) {
        resolvedRuleId = rule.id;
        ruleName = rule.name;
        notifyConfig = {
          notifyOwner: rule.notifyOwner,
          notifyAdmins: rule.notifyAdmins,
          notifyEmail: rule.notifyEmail,
          notifyZaloIds: rule.notifyZaloIds,
        };
      }
    }

    try {
      const trigger = await this.prisma.alarmTrigger.create({
        data: {
          robotId: robot.id,
          ruleId: resolvedRuleId,
          ruleName: body.rule_name,
          eventType: body.event_type,
          lightPattern:
            typeof body.light_pattern === 'string' ? body.light_pattern : 'OFF',
          buzzerPattern:
            typeof body.buzzer_pattern === 'string' ? body.buzzer_pattern : 'OFF',
          dwellS: typeof body.dwell_s === 'number' ? body.dwell_s : 0,
          meta: (body.meta ?? null) as Prisma.InputJsonValue,
        },
      });
      this.logger.log(
        `alarm trigger id=${trigger.id} robot=${robot.id} rule="${body.rule_name}" event=${body.event_type}`,
      );
      // PWA's useAlarmSocket hook validates `event_type` (snake_case) and the
      // AlarmProvider stub-builder reads snake_case keys. Re-shape the Prisma
      // row so the socket payload mirrors the MQTT wire contract instead of
      // the database column names.
      this.socket.broadcastAlarmTrigger(robot.id, {
        id: trigger.id,
        rule_id: trigger.ruleId,
        rule_name: trigger.ruleName,
        event_type: trigger.eventType,
        light_pattern: trigger.lightPattern,
        buzzer_pattern: trigger.buzzerPattern,
        dwell_s: trigger.dwellS,
        ts: Math.floor(trigger.firedAt.getTime() / 1000),
        data: trigger.meta,
      });

      // V5.15c9: fan out per-rule notifications. Rules created before this
      // column existed default to notifyOwner=true, so the robot owner
      // still gets the email even without explicit reconfiguration.
      if (notifyConfig) {
        const extraEmails = (notifyConfig.notifyEmail ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const extraZaloIds = Array.isArray(notifyConfig.notifyZaloIds)
          ? (notifyConfig.notifyZaloIds as unknown[])
              .map((v) => String(v).trim())
              .filter(Boolean)
          : [];
        const messageVi = this.buildAlarmNotificationBody(
          ruleName ?? trigger.ruleName,
          trigger.eventType,
          trigger.dwellS,
        );
        void this.notifications
          .notifyForAlarmRule(robot.userId, trigger.eventType, messageVi, {
            notifyOwner: notifyConfig.notifyOwner,
            notifyAdmins: notifyConfig.notifyAdmins,
            extraEmails,
            extraZaloIds,
          })
          .catch((err) =>
            this.logger.warn(
              `alarm notification dispatch failed: ${(err as Error).message}`,
            ),
          );
      }
    } catch (err) {
      this.logger.warn(
        `alarm trigger persist failed for ${robot.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Vietnamese notification body for an alarm trigger. Kept short so SMS-bridged
   * Zalo messages stay under the 1900-char ZaloChannel cap and email previews
   * are readable on a phone lock screen.
   */
  private buildAlarmNotificationBody(
    ruleName: string,
    eventType: string,
    dwellS: number,
  ): string {
    const kindVi =
      KIND_TO_MESSAGE_VI[eventType.toLowerCase()] ??
      `Sự kiện ${eventType}`;
    const dwellStr = dwellS > 0 ? ` (kéo dài ${dwellS}s)` : '';
    return `${kindVi}${dwellStr}. Luật: "${ruleName}".`;
  }

  /**
   * Battery handler. Pi `battery_watcher` publishes a transition-event payload:
   *
   *   { "level": "low"|"critical", "pct": <0..100>, "robot": <serial>, "ts": <ms> }
   *
   * (Historical schema also accepted `percent` and `voltage`; we still honor it
   * for backward compatibility with older Pi builds.) Steady-state battery % is
   * also embedded in every STATUS frame, so this handler runs only on threshold
   * crossings — but DB persistence is identical. Fan out raw to the per-robot
   * socket room and piggy-back on the ≥1% debounce.
   */
  private async handleBatteryMessage(
    robot: { id: string; userId: string },
    body: any,
  ): Promise<void> {
    this.socket.broadcastRobotBattery(robot.id, body);

    const pct =
      typeof body?.pct === 'number' ? body.pct
        : typeof body?.percent === 'number' ? body.percent
        : null;
    if (pct === null) return;

    const cached = this.robotState.get(robot.id);
    const prevPct = cached?.lastBatteryPct ?? null;
    if (prevPct !== null && Math.abs(pct - prevPct) < BATTERY_DB_DELTA_PCT) {
      return;
    }

    try {
      await this.prisma.robot.update({
        where: { id: robot.id },
        data: { batteryLevel: pct },
      });
    } catch (err) {
      this.logger.warn(
        `battery persist failed for ${robot.id}: ${(err as Error).message}`,
      );
      return;
    }

    this.robotState.set(robot.id, {
      userId: robot.userId,
      lastDbHeartbeat: cached?.lastDbHeartbeat ?? Date.now(),
      lastStatus: cached?.lastStatus ?? RobotStatus.OFFLINE,
      lastBatteryPct: pct,
    });
  }

  /**
   * V5.6 peripheral hub handler. Pi publishes the D1 R32 snapshot (relay,
   * DHT, watchdog, fw, heap) retained=true so a fresh dashboard connection
   * gets the latest state immediately. We fan it out to the per-robot
   * Socket.IO room as `robot:peripherals` — no DB persistence because the
   * payload is high-cadence telemetry without long-term query value (DHT
   * could be persisted to Telemetry if we want time-series later).
   */
  private handlePeripheralStateMessage(
    robot: { id: string; userId: string },
    body: any,
  ): void {
    if (!body || typeof body !== 'object') return;
    this.socket.broadcastRobotPeripherals(robot.id, body);
  }

  /**
   * Generic Web → Pi command forwarder. Used by the REST control endpoints
   * to pump commands through the same TCP-MQTT path the backend already
   * holds open to the broker. The browser used to publish these topics
   * directly over MQTT-WSS, but that connection has to share its outbound
   * channel with high-cadence telemetry PUBACKs (IMU/ODOM @20 Hz) which
   * added 500 ms-1 s of head-of-line blocking to motor commands. Routing
   * through the backend gives us the same low-latency profile the relay
   * endpoint already enjoys.
   *
   * Only suffixes in this whitelist may be forwarded — `status`, `safety`,
   * `heartbeat`, etc. are Pi → Web and must never be impersonated from the
   * dashboard; `alarm/rules` + `peripherals/cmd` go through their own
   * dedicated services.
   */
  private static readonly FORWARD_SUFFIX_WHITELIST = new Set<string>([
    'command',
    'motor',
    'speed',
    'emergency',
    'light',
    'main_light',
    'safety_config',
    'nav_command',
    'gps_route',
    'buzzer',
    'light_pattern',
    'odom_reset',
    'light_schedule',
  ]);

  publishToRobot(
    serial: string,
    suffix: string,
    payload: unknown,
    options: { qos?: 0 | 1 | 2; retain?: boolean } = {},
  ): { ok: boolean; reason?: string } {
    if (!MqttIngestService.FORWARD_SUFFIX_WHITELIST.has(suffix)) {
      return { ok: false, reason: `suffix not allowed: ${suffix}` };
    }
    if (!this.client || !this.client.connected) {
      this.logger.warn(`publishToRobot: broker not connected, dropping ${serial}/${suffix}`);
      return { ok: false, reason: 'broker_offline' };
    }
    const topic = `${this.topicPrefix}/${serial}/${suffix}`;
    const qos = options.qos ?? 0;
    const retain = options.retain ?? false;
    this.client.publish(topic, JSON.stringify(payload), { qos, retain });
    return { ok: true };
  }

  /**
   * Web → Pi peripheral command. Called by the REST controller when an
   * operator toggles the warning light/horn from the dashboard. The payload
   * schema mirrors `peripheral_hub.PeripheralHub.handle_periph_command` on
   * the Pi side:
   *
   *     { "action": "relay",    "state": "on"|"off"|"toggle"|"test" }
   *     { "action": "polarity", "active_low": <bool> }
   *     { "action": "oled",     "text": "<str>" }
   *     { "action": "time_sync" }
   *     { "action": "request_status" }
   *     { "action": "keepalive" }
   *
   * Not retained — these are imperative one-shot actions; if the Pi missed
   * one because it was offline, the operator can simply repeat the click.
   */
  publishPeripheralCommand(serial: string, payload: unknown): boolean {
    if (!this.client || !this.client.connected) {
      this.logger.warn(
        `publishPeripheralCommand: broker not connected, skipping ${serial}`,
      );
      return false;
    }
    const topic = `${this.topicPrefix}/${serial}/peripherals/cmd`;
    this.client.publish(topic, JSON.stringify(payload), {
      qos: 1,
      retain: false,
    });
    return true;
  }

  /**
   * Called from AlarmRuleService after CRUD. We don't import AlarmRuleService
   * directly here for publishing — instead AlarmRuleService composes the
   * payload and calls us. Topic is retained so the Pi gets the current rule
   * set when it reconnects without needing to query the backend over HTTP.
   */
  publishAlarmRules(serial: string, payload: unknown): void {
    if (!this.client || !this.client.connected) {
      this.logger.warn(
        `publishAlarmRules: broker not connected, skipping ${serial}`,
      );
      return;
    }
    const topic = `${this.topicPrefix}/${serial}/alarm/rules`;
    this.client.publish(topic, JSON.stringify(payload), {
      qos: 1,
      retain: true,
    });
  }

  /**
   * On startup (after broker connects) republish each robot's rule set so the
   * `alarm/rules` retained payload reflects what's in our DB even if the
   * broker's retain store was wiped. AlarmRuleService owns the wire format; we
   * just iterate robot IDs and delegate.
   */
  private async hydrateAlarmRules(): Promise<void> {
    try {
      const robots = await this.prisma.robot.findMany({
        select: { id: true },
      });
      for (const robot of robots) {
        await this.alarmRules.publishRulesForRobot(robot.id);
      }
      if (robots.length > 0) {
        this.logger.log(
          `alarm rules hydrated for ${robots.length} robot(s)`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `hydrateAlarmRules failed: ${(err as Error).message}`,
      );
    }
  }
}
