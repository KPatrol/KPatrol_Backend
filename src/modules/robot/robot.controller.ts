import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Inject,
  forwardRef,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { RobotService } from './robot.service';
import { MqttIngestService } from '../mqtt-ingest/mqtt-ingest.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateRobotDto, UpdateRobotDto, UpdateRobotConfigDto } from './robot.dto';
import { CreateScriptPatrolDto } from './waypoint.dto';
import { STREAM_TOKEN_TTL_SECONDS } from '../../config/auth.config';

@Controller('robots')
@UseGuards(JwtAuthGuard)
export class RobotController {
  constructor(
    private robotService: RobotService,
    private jwt: JwtService,
    @Inject(forwardRef(() => MqttIngestService))
    private mqtt: MqttIngestService,
  ) {}

  /**
   * Issue a short-TTL signed token that the operator's browser passes to the
   * Pi's MJPEG server. Why a separate token instead of session JWT:
   *   - Stream tokens travel in the URL (`?token=...`) where they can leak via
   *     referer headers / proxy logs. A 60s TTL bounds the blast radius.
   *   - Pi only needs to verify HMAC + claims; it never sees the user's
   *     long-lived session credentials.
   */
  @Get(':id/stream-token')
  async getStreamToken(@Request() req, @Param('id') id: string) {
    // Throws NotFoundException if user doesn't own the robot.
    await this.robotService.findOne(id, req.user.id);

    const token = await this.jwt.signAsync(
      {
        sub: req.user.id,
        robotId: id,
        scope: 'mjpeg',
      },
      { expiresIn: STREAM_TOKEN_TTL_SECONDS },
    );

    return {
      token,
      expiresIn: STREAM_TOKEN_TTL_SECONDS,
    };
  }

  @Post()
  create(@Request() req, @Body() dto: CreateRobotDto) {
    return this.robotService.create(req.user.id, dto);
  }

  @Get()
  findAll(@Request() req) {
    return this.robotService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(@Request() req, @Param('id') id: string) {
    return this.robotService.findOne(id, req.user.id);
  }

  @Put(':id')
  update(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateRobotDto,
  ) {
    return this.robotService.update(id, req.user.id, dto);
  }

  // REST convention — PATCH aliased to the same partial-update logic as PUT.
  // The service's update() already merges only the provided fields. Some HTTP
  // clients (and most code generators) emit PATCH for partial updates and
  // refuse to call a PUT-only endpoint.
  @Patch(':id')
  patch(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateRobotDto,
  ) {
    return this.robotService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  remove(@Request() req, @Param('id') id: string) {
    return this.robotService.remove(id, req.user.id);
  }

  @Get(':id/stats')
  getStats(@Request() req, @Param('id') id: string) {
    return this.robotService.getRobotStats(id, req.user.id);
  }

  @Get(':id/config')
  getConfig(@Request() req, @Param('id') id: string) {
    return this.robotService.getConfig(id, req.user.id);
  }

  @Put(':id/config')
  updateConfig(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateRobotConfigDto,
  ) {
    return this.robotService.updateConfig(id, req.user.id, dto);
  }

  @Get(':id/alerts')
  getAlerts(@Request() req, @Param('id') id: string) {
    return this.robotService.getActiveAlerts(id, req.user.id);
  }

  @Put('alerts/:alertId/acknowledge')
  acknowledgeAlert(@Request() req, @Param('alertId') alertId: string) {
    return this.robotService.acknowledgeAlert(alertId, req.user.id);
  }

  @Post(':id/patrol')
  createPatrol(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: CreateScriptPatrolDto,
  ) {
    return this.robotService.createPatrol(id, req.user.id, dto.name, {
      loop: dto.loop ?? false,
      steps: dto.steps,
    });
  }

  @Get(':id/patrols')
  listPatrols(@Request() req, @Param('id') id: string) {
    return this.robotService.listPatrols(id, req.user.id);
  }

  @Put(':id/patrols/:patrolId/status')
  updatePatrolStatus(
    @Request() req,
    @Param('id') id: string,
    @Param('patrolId') patrolId: string,
    @Body() body: { status: string },
  ) {
    return this.robotService.updatePatrolStatus(id, patrolId, req.user.id, body.status);
  }

  @Delete(':id/patrols/:patrolId')
  deletePatrol(
    @Request() req,
    @Param('id') id: string,
    @Param('patrolId') patrolId: string,
  ) {
    return this.robotService.deletePatrol(id, patrolId, req.user.id);
  }

  /**
   * Generic Web → Pi command forwarder.
   *
   * The PWA used to publish motor / speed / nav / light commands directly
   * over MQTT-WSS. That worked, but the same WSS connection also receives
   * 20 Hz IMU + 20 Hz ODOM telemetry, and the QoS-1 PUBACK queue for that
   * inbound stream serialised the browser's outbound publishes — motor
   * commands felt 500 ms-1 s laggy. The backend already holds a low-latency
   * TCP MQTT connection to the broker (it doesn't subscribe to the noisy
   * telemetry topics), so routing operator commands through here gives us
   * the same near-instant feel the relay endpoint already has.
   *
   * Allowed suffixes (whitelist enforced in MqttIngestService):
   *   command, motor, speed, emergency, light, main_light,
   *   safety_config, nav_command, gps_route, buzzer, light_pattern,
   *   odom_reset
   *
   * QoS picked by the body (`qos: 0|1`, default 0). Use 1 for must-deliver
   * (emergency / light / safety_config); 0 for high-cadence joystick frames
   * where the next packet renders the last one obsolete in <100 ms.
   */
  // V5.7: high-cadence command path — joystick at 10–20 Hz already
  // serialises naturally through MQTT, but a runaway client (or a bug in
  // PWA send-loop) could pin a robot's broker quota. 600/min ≈ 10/s is
  // 50–100% headroom above legitimate burst use and still keeps a single
  // misbehaving session from flooding the bus.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post(':id/forward/:suffix(*)')
  async forwardCommand(
    @Request() req,
    @Param('id') id: string,
    @Param('suffix') suffix: string,
    @Body() body: { payload?: unknown; qos?: 0 | 1 | 2 },
  ) {
    if (!body || body.payload === undefined) {
      throw new BadRequestException('payload is required');
    }
    if (typeof suffix !== 'string' || !suffix.length || suffix.length > 64) {
      throw new BadRequestException('suffix is required (1–64 chars)');
    }
    // V5.8: hot path — joystick fires this at 10-20 Hz. findOne pulls
    // sessions/patrols/alerts join trees the publish doesn't need, and at
    // 20 Hz that query alone has been measured at 30-200 ms p95 under
    // load → felt like input lag in the operator UI. findOneForCommand
    // selects only {id,userId,serialNumber} and caches per (user,robot)
    // for 60 s, dropping steady-state ownership lookup to ~0 ms.
    const robot = await this.robotService.findOneForCommand(id, req.user.id);
    const qos = body.qos === 1 || body.qos === 2 ? body.qos : 0;
    const res = this.mqtt.publishToRobot(robot.serialNumber, suffix, body.payload, { qos });
    if (!res.ok) {
      throw new BadRequestException(res.reason || 'publish failed');
    }
    return { ok: true, suffix };
  }

  /**
   * V5.6: peripheral-hub command bridge. The operator's PWA POSTs the same
   * payload schema the Pi expects on `kpatrol/<serial>/peripherals/cmd`:
   *
   *     { "action": "relay",    "state": "on" | "off" | "toggle" | "test" }
   *     { "action": "polarity", "active_low": <bool> }
   *     { "action": "oled",     "text": "<str>" }
   *     { "action": "time_sync" }
   *     { "action": "request_status" }
   *     { "action": "keepalive" }
   *
   * We resolve the robot (ownership-checked) and forward the payload onto
   * the broker. The Pi will react and stream the next `peripherals/state`
   * line, which the dashboard already listens to via Socket.IO.
   */
  // Peripheral hub commands are click-driven (BẬT / TẮT relay), not
  // continuous — 60/min covers the worst-case operator panic-click without
  // letting a runaway script spam the broker.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':id/peripherals/command')
  async sendPeripheralCommand(
    @Request() req,
    @Param('id') id: string,
    @Body() body: { action?: string; [key: string]: unknown },
  ) {
    if (!body || typeof body.action !== 'string' || !body.action.trim()) {
      throw new BadRequestException('action is required');
    }
    const action = body.action.toLowerCase().trim();
    const allowed = new Set([
      'relay', 'polarity', 'oled', 'time_sync', 'request_status', 'keepalive',
    ]);
    if (!allowed.has(action)) {
      throw new BadRequestException(`unknown action: ${action}`);
    }
    if (action === 'relay') {
      const state = String(body.state ?? '').toLowerCase();
      if (!['on', 'off', 'toggle', 'test'].includes(state)) {
        throw new BadRequestException(
          `relay state must be one of on|off|toggle|test`,
        );
      }
    }
    if (action === 'oled' && typeof body.text !== 'string') {
      throw new BadRequestException('oled requires "text" string');
    }

    // Throws NotFoundException if user doesn't own the robot.
    const robot = await this.robotService.findOne(id, req.user.id);
    const published = this.mqtt.publishPeripheralCommand(
      robot.serialNumber,
      { ...body, action },
    );
    return { ok: published, action };
  }
}
