import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as mqtt from 'mqtt';
import { Prisma, AlertSeverity, AlertType, RobotStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SocketGateway } from '../socket/socket.gateway';

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

@Injectable()
export class MqttIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MqttIngestService');
  private client: mqtt.MqttClient | null = null;
  private readonly topicPrefix: string;
  private readonly enabled: boolean;
  // Keyed by robotId — populated on first message per robot. Lets us debounce
  // DB writes and emit user-scoped `robot:status:changed` only on transitions.
  private readonly robotState = new Map<string, RobotIngestState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly socket: SocketGateway,
  ) {
    this.topicPrefix = process.env.MQTT_TOPIC_PREFIX || 'kpatrol';
    // Soft-disable when MQTT_HOST is empty so dev environments (and CI) don't
    // fight a missing broker. Production deploys must set MQTT_HOST.
    this.enabled = Boolean(process.env.MQTT_HOST);
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn(
        'MQTT_HOST not set — detection ingest disabled. ' +
          'Set MQTT_HOST/MQTT_PORT/MQTT_USERNAME/MQTT_PASSWORD to enable.',
      );
      return;
    }
    this.connect();
  }

  onModuleDestroy(): void {
    if (this.client) {
      this.client.end(true);
      this.client = null;
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
    // topic = "<prefix>/<serial>/<suffix>" where suffix ∈ {alert,heartbeat,status,safety}
    const parts = topic.split('/');
    if (parts.length !== 3) return null;
    if (parts[0] !== this.topicPrefix) return null;
    const serial = parts[1];
    const suffix = parts[2];
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
   * 2 Hz. We re-broadcast every payload (cheap) but only persist battery on
   * ≥1% change to avoid hammering the DB with single-digit jitter.
   */
  private async handleStatusMessage(
    robot: { id: string; userId: string },
    body: any,
  ): Promise<void> {
    this.socket.broadcastRobotStatus(robot.id, body);

    const battery = typeof body?.battery === 'number' ? body.battery : null;
    if (battery === null) return;

    const cached = this.robotState.get(robot.id);
    const prevPct = cached?.lastBatteryPct ?? null;
    if (prevPct !== null && Math.abs(battery - prevPct) < BATTERY_DB_DELTA_PCT) {
      return;
    }

    try {
      await this.prisma.robot.update({
        where: { id: robot.id },
        data: { batteryLevel: battery, lastSeen: new Date() },
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
      lastStatus: cached?.lastStatus ?? RobotStatus.ONLINE,
      lastBatteryPct: battery,
    });
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
}
