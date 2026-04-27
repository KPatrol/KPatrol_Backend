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
import { RobotService } from '../robot/robot.service';
import { RobotStatus } from '@prisma/client';

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
    origin: '*',
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

  constructor(private robotService: RobotService) {}

  async handleConnection(client: Socket) {
    const { type, robotId, userId } = client.handshake.query as {
      type: 'robot' | 'client';
      robotId?: string;
      userId?: string;
    };

    this.logger.log(`Connection: ${type} - ${robotId || userId}`);

    if (type === 'robot' && robotId) {
      this.connectedRobots.set(robotId, client);
      client.data = { type: 'robot', robotId };

      // Update robot status
      await this.robotService.updateStatus(robotId, RobotStatus.ONLINE);
      await this.robotService.startSession(robotId);

      // Notify clients
      this.broadcastToClients(robotId, 'robot:connected', { robotId });
    } else if (type === 'client' && robotId) {
      if (!this.connectedClients.has(robotId)) {
        this.connectedClients.set(robotId, new Set());
      }
      this.connectedClients.get(robotId)!.add(client);
      client.data = { type: 'client', robotId, userId };

      // Send current robot state if available
      const state = this.robotStates.get(robotId);
      if (state) {
        client.emit('robot:state', state);
      }
    }
  }

  async handleDisconnect(client: Socket) {
    const { type, robotId } = client.data || {};

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

    // Update battery level in database
    if (state.batteryLevel !== undefined) {
      await this.robotService.updateBatteryLevel(robotId, state.batteryLevel);
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
    const savedLog = await this.robotService.addPatrolLog(
      log.patrolId,
      log.logType,
      log.message,
      log.data,
    );

    const { robotId } = client.data || {};
    if (robotId) {
      this.broadcastToClients(robotId, 'robot:patrol:log', savedLog);
    }
  }

  // ==================== Client Commands ====================

  @SubscribeMessage('control:command')
  handleControlCommand(
    @ConnectedSocket() client: Socket,
    @MessageBody() command: ControlCommand,
  ) {
    const { robotId } = client.data || {};
    if (!robotId) return;

    const robotSocket = this.connectedRobots.get(robotId);
    if (robotSocket) {
      robotSocket.emit('control:command', command);
      this.logger.log(`Command sent to robot ${robotId}: ${command.type}`);
    } else {
      client.emit('error', { message: 'Robot is not connected' });
    }
  }

  @SubscribeMessage('control:move')
  handleControlMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() move: { linear: number; angular: number },
  ) {
    const { robotId } = client.data || {};
    if (!robotId) return;

    const robotSocket = this.connectedRobots.get(robotId);
    if (robotSocket) {
      robotSocket.emit('control:move', move);
    }
  }

  @SubscribeMessage('control:mecanum')
  handleMecanumControl(
    @ConnectedSocket() client: Socket,
    @MessageBody() mecanum: { vx: number; vy: number; omega: number },
  ) {
    const { robotId } = client.data || {};
    if (!robotId) return;

    const robotSocket = this.connectedRobots.get(robotId);
    if (robotSocket) {
      robotSocket.emit('control:mecanum', mecanum);
    }
  }

  @SubscribeMessage('control:motor')
  handleMotorControl(
    @ConnectedSocket() client: Socket,
    @MessageBody() motor: { motorId: number; speed: number; direction: 'forward' | 'backward' | 'stop' },
  ) {
    const { robotId } = client.data || {};
    if (!robotId) return;

    const robotSocket = this.connectedRobots.get(robotId);
    if (robotSocket) {
      robotSocket.emit('control:motor', motor);
    }
  }

  @SubscribeMessage('control:emergency')
  handleEmergencyStop(@ConnectedSocket() client: Socket) {
    const { robotId } = client.data || {};
    if (!robotId) return;

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
    const { robotId } = client.data || {};
    if (!robotId) return;

    const robotSocket = this.connectedRobots.get(robotId);
    if (robotSocket) {
      robotSocket.emit('patrol:start', patrol);
    }
  }

  @SubscribeMessage('patrol:stop')
  handlePatrolStop(@ConnectedSocket() client: Socket) {
    const { robotId } = client.data || {};
    if (!robotId) return;

    const robotSocket = this.connectedRobots.get(robotId);
    if (robotSocket) {
      robotSocket.emit('patrol:stop');
    }
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
