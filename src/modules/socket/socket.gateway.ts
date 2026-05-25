import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Inject, forwardRef } from '@nestjs/common';
import { RobotService } from '../robot/robot.service';
import { RobotStatus } from '@prisma/client';
import { getAllowedOrigins } from '../../config/cors.config';
import { getRobotApiKey } from '../../config/auth.config';
import { TokenBucketRateLimiter } from './rate-limiter';

interface RobotState {
  position: { x: number; y: number; theta: number };
  velocity: { linear: number; angular: number };
  batteryLevel: number;
  status: string;
  sensors: Record<string, any>;
}

interface ControlCommand {
  type: 'move' | 'stop' | 'patrol' | 'return_home' | 'emergency_stop';
  data?: any;
}

@WebSocketGateway({
  cors: {
    origin: getAllowedOrigins(),
    credentials: true,
  },
  namespace: '/robot',
})
@Injectable()
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('SocketGateway');
  private connectedRobots = new Map<string, Socket>();
  private connectedClients = new Map<string, Set<Socket>>();
  private robotStates = new Map<string, RobotState>();
  private controlLimiter = new TokenBucketRateLimiter({
    capacity: 30,
    refillPerSec: 15,
  });
  // Throttle "rate-limit hit" log lines so a misbehaving client cannot also
  // spam the log file. Keyed by socket.id, value is last-warned timestamp.
  private lastLimitLogMs = new Map<string, number>();

  constructor(
    // V5.6: RobotModule and SocketModule reach each other via forwardRef
    // (see socket.module.ts) — @Inject(forwardRef(...)) is required for
    // Nest to defer the lookup until both modules are fully constructed.
    @Inject(forwardRef(() => RobotService))
    private robotService: RobotService,
    private jwt: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    const { type, robotId } = client.handshake.query as {
      type: 'robot' | 'client';
      robotId?: string;
    };

    try {
      // ----- AUTH GATE -----------------------------------------------------
      // Anonymous handshakes were allowed in V8 — V10 requires every socket
      // to identify itself before any room state is touched. We disconnect
      // unauthenticated peers immediately so a malicious client cannot, for
      // example, send `control:emergency` against an unrelated robot.
      const authResult = this.authenticate(client, type, robotId);
      if (!authResult.ok) {
        this.logger.warn(
          `auth rejected: type=${type} robot=${robotId} reason=${authResult.reason}`,
        );
        client.emit('auth:error', { message: authResult.reason });
        client.disconnect(true);
        return;
      }
      const { userId } = authResult;

      // Authenticated clients must own the robot they're subscribing to.
      // Robots (API-key auth) are trusted operators of their own serial and
      // skip this DB check — abuse there would require leaking ROBOT_API_KEY.
      if (type === 'client' && userId && robotId) {
        try {
          await this.robotService.assertOwnership(robotId, userId);
        } catch (err) {
          this.logger.warn(
            `auth rejected: user=${userId} not owner of robot=${robotId} (${(err as Error).message})`,
          );
          client.emit('auth:error', { message: 'access denied' });
          client.disconnect(true);
          return;
        }
      }

      this.logger.log(
        `Connection: ${type} - robot=${robotId} ${userId ? `user=${userId}` : ''}`,
      );

      if (type === 'robot' && robotId) {
        this.connectedRobots.set(robotId, client);
        client.data = { type: 'robot', robotId };

        await this.robotService.updateStatus(robotId, RobotStatus.ONLINE);
        await this.robotService.startSession(robotId);

        this.broadcastToClients(robotId, 'robot:connected', { robotId });
      } else if (type === 'client') {
        // Always join the per-user room so MqttIngestService can fan out
        // robot:status:changed to the listing page without needing each row
        // to hold its own per-robot socket.
        if (userId) {
          client.join(`user:${userId}`);
        }
        if (robotId) {
          if (!this.connectedClients.has(robotId)) {
            this.connectedClients.set(robotId, new Set());
          }
          this.connectedClients.get(robotId)!.add(client);
          client.data = { type: 'client', robotId, userId };

          const state = this.robotStates.get(robotId);
          if (state) {
            client.emit('robot:state', state);
          }
        } else {
          // Dashboard mode: client wants user-scoped events only.
          client.data = { type: 'client', userId };
        }
      }
    } catch (err) {
      this.logger.error(
        `handleConnection failed for ${type}=${robotId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      client.emit('error', { message: 'Connection setup failed' });
      client.disconnect(true);
    }
  }

  /**
   * Validate handshake credentials. Two flows:
   *   - type=robot   → shared ROBOT_API_KEY (long-lived, env-rotated)
   *   - type=client  → user JWT (same secret as REST auth)
   *
   * Token sources (checked in order): handshake.auth.token → query.token →
   * Authorization: Bearer header. The auth field is preferred because it is
   * not logged by reverse proxies.
   */
  private authenticate(
    client: Socket,
    type: string | undefined,
    robotId: string | undefined,
  ):
    | { ok: true; userId?: string }
    | { ok: false; reason: string } {
    // Robots must always declare which serial they own; clients may attach
    // without a robotId when they just want the user-scoped dashboard channel
    // (listing page heartbeat fan-out). The per-robot rooms below short-circuit
    // when robotId is empty.
    if (type === 'robot' && !robotId) {
      return { ok: false, reason: 'missing robotId' };
    }

    const auth = (client.handshake.auth ?? {}) as Record<string, unknown>;
    const query = client.handshake.query as Record<string, string | string[]>;
    const headerAuth =
      (client.handshake.headers['authorization'] as string | undefined) ?? '';
    const bearer = headerAuth.startsWith('Bearer ')
      ? headerAuth.slice('Bearer '.length)
      : '';
    const token =
      (typeof auth.token === 'string' && auth.token) ||
      (typeof query.token === 'string' && query.token) ||
      bearer ||
      '';

    if (type === 'robot') {
      const expected = getRobotApiKey();
      const provided =
        (typeof auth.apiKey === 'string' && auth.apiKey) ||
        (typeof query.apiKey === 'string' && query.apiKey) ||
        token;
      if (!provided || provided !== expected) {
        return { ok: false, reason: 'invalid robot api key' };
      }
      return { ok: true };
    }

    if (type === 'client') {
      if (!token) return { ok: false, reason: 'missing token' };
      try {
        const payload = this.jwt.verify<{ sub: string }>(token);
        if (!payload?.sub) {
          return { ok: false, reason: 'token missing subject' };
        }
        return { ok: true, userId: payload.sub };
      } catch (err) {
        return {
          ok: false,
          reason: `invalid token (${(err as Error).message})`,
        };
      }
    }

    return { ok: false, reason: `unknown type "${type}"` };
  }

  async handleDisconnect(client: Socket) {
    const { type, robotId } = client.data || {};

    try {
      if (type === 'robot' && robotId) {
        this.connectedRobots.delete(robotId);
        this.robotStates.delete(robotId);

        // Update robot status
        await this.robotService.updateStatus(robotId, RobotStatus.OFFLINE);

        // Notify clients
        this.broadcastToClients(robotId, 'robot:disconnected', { robotId });

        this.logger.log(`Robot disconnected: ${robotId}`);
      } else if (type === 'client' && robotId) {
        this.connectedClients.get(robotId)?.delete(client);
        this.logger.log(`Client disconnected from robot: ${robotId}`);
      }
      // Always release limiter state — applies to robots and unknown types
      // too, so a flood of failed handshakes can't grow the map unbounded.
      this.controlLimiter.release(client.id);
      this.lastLimitLogMs.delete(client.id);
    } catch (err) {
      this.logger.error(
        `handleDisconnect failed for ${type}=${robotId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  // ==================== Robot Events ====================

  @SubscribeMessage('robot:state')
  async handleRobotState(
    @ConnectedSocket() client: Socket,
    @MessageBody() state: RobotState,
  ) {
    const { robotId } = client.data || {};
    if (!robotId) return;

    this.robotStates.set(robotId, state);

    try {
      // Update battery level in database
      if (state.batteryLevel !== undefined) {
        await this.robotService.updateBatteryLevel(robotId, state.batteryLevel);
      }
    } catch (err) {
      this.logger.error(
        `handleRobotState DB update failed for ${robotId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Continue: in-memory state already updated, broadcast still useful
    }

    // Broadcast to all connected clients
    this.broadcastToClients(robotId, 'robot:state', state);
  }

  @SubscribeMessage('robot:telemetry')
  handleRobotTelemetry(
    @ConnectedSocket() client: Socket,
    @MessageBody() telemetry: any,
  ) {
    const { robotId } = client.data || {};
    if (!robotId) return;

    this.broadcastToClients(robotId, 'robot:telemetry', telemetry);
  }

  @SubscribeMessage('robot:alert')
  async handleRobotAlert(
    @ConnectedSocket() client: Socket,
    @MessageBody() alert: { type: string; severity: string; message: string; data?: any },
  ) {
    const { robotId } = client.data || {};
    if (!robotId) return;

    try {
      // Save alert to database
      const savedAlert = await this.robotService.createAlert(
        robotId,
        alert.type,
        alert.severity,
        alert.message,
        alert.data,
      );

      // Broadcast to clients
      this.broadcastToClients(robotId, 'robot:alert', savedAlert);
    } catch (err) {
      this.logger.error(
        `handleRobotAlert failed for ${robotId} (${alert.type}): ${(err as Error).message}`,
        (err as Error).stack,
      );
      // Fall back to broadcasting unsaved alert so operators still see it
      this.broadcastToClients(robotId, 'robot:alert', { ...alert, robotId, persisted: false });
    }
  }

  @SubscribeMessage('robot:camera')
  handleRobotCamera(
    @ConnectedSocket() client: Socket,
    @MessageBody() frame: { data: string; timestamp: number },
  ) {
    const { robotId } = client.data || {};
    if (!robotId) return;

    // Broadcast camera frame to clients (base64 encoded)
    this.broadcastToClients(robotId, 'robot:camera', frame);
  }

  @SubscribeMessage('robot:patrol:log')
  async handlePatrolLog(
    @ConnectedSocket() client: Socket,
    @MessageBody() log: { patrolId: string; logType: string; message: string; data?: any },
  ) {
    const { type, robotId } = client.data || {};
    if (type !== 'robot' || !robotId) return; // only authenticated robots
    if (!log || typeof log.patrolId !== 'string' || typeof log.logType !== 'string') return;
    try {
      // Reject patrolId spoofing — robot may only log against its own patrols.
      const owned = await this.robotService.patrolBelongsToRobot(log.patrolId, robotId);
      if (!owned) {
        this.logger.warn(
          `handlePatrolLog rejected: patrol=${log.patrolId} does not belong to robot=${robotId}`,
        );
        return;
      }
      const savedLog = await this.robotService.addPatrolLog(
        log.patrolId,
        log.logType,
        log.message,
        log.data,
      );
      this.broadcastToClients(robotId, 'robot:patrol:log', savedLog);
    } catch (err) {
      this.logger.error(
        `handlePatrolLog failed for patrol=${log.patrolId} robot=${robotId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  // ==================== Client Commands ====================

  /**
   * Gate a control:* event through the per-socket token bucket. Returns the
   * robotId+robotSocket if the call should proceed, or null if it was either
   * unauthorised or rate-limited (in which case the caller has already been
   * notified).
   */
  private gateControl(
    client: Socket,
    eventName: string,
  ): { robotId: string; robotSocket: Socket } | null {
    const { type, robotId } = client.data || {};
    if (type !== 'client' || !robotId) {
      // Robots must not loopback control:* — only authenticated clients.
      return null;
    }
    if (!this.controlLimiter.tryAcquire(client.id)) {
      const now = Date.now();
      const last = this.lastLimitLogMs.get(client.id) ?? 0;
      if (now - last > 2000) {
        this.lastLimitLogMs.set(client.id, now);
        this.logger.warn(
          `rate-limit dropped event=${eventName} socket=${client.id} robot=${robotId}`,
        );
      }
      client.emit('control:throttled', { event: eventName });
      return null;
    }
    const robotSocket = this.connectedRobots.get(robotId);
    if (!robotSocket) {
      client.emit('error', { message: 'Robot is not connected' });
      return null;
    }
    return { robotId, robotSocket };
  }

  @SubscribeMessage('control:command')
  handleControlCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() command: ControlCommand,
  ) {
    const gate = this.gateControl(client, 'control:command');
    if (!gate) return;
    gate.robotSocket.emit('control:command', command);
    this.logger.log(`Command sent to robot ${gate.robotId}: ${command.type}`);
  }

  @SubscribeMessage('control:move')
  handleControlMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() move: { linear: number; angular: number },
  ) {
    const gate = this.gateControl(client, 'control:move');
    if (!gate) return;
    gate.robotSocket.emit('control:move', move);
  }

  @SubscribeMessage('control:mecanum')
  handleMecanumControl(
    @ConnectedSocket() client: Socket,
    @MessageBody() mecanum: { vx: number; vy: number; omega: number },
  ) {
    const gate = this.gateControl(client, 'control:mecanum');
    if (!gate) return;
    gate.robotSocket.emit('control:mecanum', mecanum);
  }

  @SubscribeMessage('control:motor')
  handleMotorControl(
    @ConnectedSocket() client: Socket,
    @MessageBody() motor: { motorId: number; speed: number; direction: 'forward' | 'backward' | 'stop' },
  ) {
    const gate = this.gateControl(client, 'control:motor');
    if (!gate) return;
    gate.robotSocket.emit('control:motor', motor);
  }

  // Emergency stop bypasses the rate limiter — a panic button must NEVER be
  // throttled. Auth still required (handshake check + client type guard).
  @SubscribeMessage('control:emergency')
  handleEmergencyStop(@ConnectedSocket() client: Socket) {
    const { type, robotId } = client.data || {};
    if (type !== 'client' || !robotId) return;
    const robotSocket = this.connectedRobots.get(robotId);
    if (robotSocket) {
      robotSocket.emit('control:emergency');
      this.logger.warn(`EMERGENCY STOP sent to robot ${robotId}`);
    }
  }

  @SubscribeMessage('patrol:start')
  handlePatrolStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() patrol: { patrolId: string },
  ) {
    const gate = this.gateControl(client, 'patrol:start');
    if (!gate) return;
    if (!patrol || typeof patrol.patrolId !== 'string') {
      client.emit('error', { message: 'patrolId required' });
      return;
    }
    gate.robotSocket.emit('patrol:start', patrol);
  }

  @SubscribeMessage('patrol:stop')
  handlePatrolStop(@ConnectedSocket() client: Socket) {
    const gate = this.gateControl(client, 'patrol:stop');
    if (!gate) return;
    gate.robotSocket.emit('patrol:stop');
  }

  // ==================== Utility Methods ====================

  private broadcastToClients(robotId: string, event: string, data: any) {
    const clients = this.connectedClients.get(robotId);
    if (clients) {
      clients.forEach((client) => {
        client.emit(event, data);
      });
    }
  }

  // External entry point for MqttIngestService — same wire format as
  // handleRobotAlert's emit so the PWA's existing `robot:alert` listener picks
  // it up unchanged. Detection alerts arrive via MQTT (Pi → broker → backend)
  // instead of Socket.IO, but operator UX must not have to know which path.
  broadcastDetectionAlert(robotId: string, alert: Record<string, any>): void {
    this.broadcastToClients(robotId, 'robot:alert', alert);
  }

  // Heartbeat/status/safety bridged from MQTT. Heartbeat fires every 5s, status
  // every 2s, safety up to 5 Hz — broadcast on each emit so the PWA's safety
  // panel and online dot stay fresh without browser-side MQTT-over-WS (which
  // is unreliable behind some corporate proxies).
  broadcastRobotHeartbeat(
    robotId: string,
    heartbeat: Record<string, any>,
  ): void {
    this.broadcastToClients(robotId, 'robot:heartbeat', heartbeat);
  }

  broadcastRobotStatus(robotId: string, status: Record<string, any>): void {
    this.broadcastToClients(robotId, 'robot:status', status);
  }

  broadcastRobotSafety(robotId: string, safety: Record<string, any>): void {
    this.broadcastToClients(robotId, 'robot:safety', safety);
  }

  // Battery telemetry from Pi INA219 sensor; PWA listens on this channel to
  // refresh battery widget without re-polling REST. Emitted at the same cadence
  // the Pi publishes (~5s) so we don't need extra throttling here.
  broadcastRobotBattery(robotId: string, battery: Record<string, any>): void {
    this.broadcastToClients(robotId, 'robot:battery', battery);
  }

  // AlarmController on the Pi fires this when a rule's continuous-duration
  // window elapses. Backend persists the trigger row, then forwards the same
  // payload so the PWA can toast / log it without a round-trip to REST.
  broadcastAlarmTrigger(robotId: string, trigger: Record<string, any>): void {
    this.broadcastToClients(robotId, 'robot:alarm:triggered', trigger);
  }

  // V5.6: D1 R32 peripheral hub snapshot (relay state, DHT11 temp/humidity,
  // watchdog, fw, heap). Pi publishes ~every 5s + on change, retained=true,
  // so a fresh dashboard connection gets the latest snapshot immediately.
  broadcastRobotPeripherals(robotId: string, snapshot: Record<string, any>): void {
    this.broadcastToClients(robotId, 'robot:peripherals', snapshot);
  }

  // Listing-page channel: per-user room receives terse {robotId, status,
  // lastSeen, batteryLevel} so the /robots grid can flip ONLINE↔OFFLINE the
  // moment the broker sees a heartbeat or LWT, without each row holding its
  // own /robot namespace socket.
  broadcastUserRobotStatusChanged(
    userId: string,
    payload: Record<string, any>,
  ): void {
    this.server.to(`user:${userId}`).emit('robot:status:changed', payload);
  }

  getRobotStatus(robotId: string): { connected: boolean; state?: RobotState } {
    return {
      connected: this.connectedRobots.has(robotId),
      state: this.robotStates.get(robotId),
    };
  }

  getConnectedRobots(): string[] {
    return Array.from(this.connectedRobots.keys());
  }
}
