import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as mqtt from 'mqtt';
import { Prisma, AlertSeverity, AlertType } from '@prisma/client';
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

@Injectable()
export class MqttIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('MqttIngestService');
  private client: mqtt.MqttClient | null = null;
  private readonly topicPrefix: string;
  private readonly enabled: boolean;

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

    const topic = `${this.topicPrefix}/+/alert`;

    this.client.on('connect', () => {
      this.logger.log(`MQTT connected — subscribing to ${topic}`);
      this.client!.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          this.logger.error(`subscribe ${topic} failed: ${err.message}`);
        }
      });
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
    const serial = this.extractSerial(topic);
    if (!serial) {
      this.logger.warn(`ignored message: cannot parse serial from ${topic}`);
      return;
    }

    let body: DetectionAlertPayload;
    try {
      body = JSON.parse(payload.toString('utf8'));
    } catch (err) {
      this.logger.warn(
        `ignored ${topic}: invalid JSON (${(err as Error).message})`,
      );
      return;
    }

    if (typeof body?.kind !== 'string' || typeof body?.confidence !== 'number') {
      this.logger.warn(`ignored ${topic}: missing kind/confidence`);
      return;
    }

    const alertType = KIND_TO_ALERT_TYPE[body.kind];
    if (!alertType) {
      this.logger.warn(`ignored ${topic}: unknown kind "${body.kind}"`);
      return;
    }

    const robot = await this.prisma.robot.findUnique({
      where: { serialNumber: serial },
      select: { id: true, userId: true },
    });
    if (!robot) {
      // Unknown robot: don't auto-create — operator may not have registered
      // it yet. Log so the situation is visible.
      this.logger.warn(`ignored ${topic}: robot serial ${serial} not registered`);
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
        `alert id=${alert.id} robot=${serial} kind=${body.kind} conf=${body.confidence.toFixed(2)}`,
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

  private extractSerial(topic: string): string | null {
    // topic = "<prefix>/<serial>/alert"
    const parts = topic.split('/');
    if (parts.length !== 3) return null;
    if (parts[0] !== this.topicPrefix) return null;
    if (parts[2] !== 'alert') return null;
    return parts[1] || null;
  }
}
