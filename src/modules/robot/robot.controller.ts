import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RobotService } from './robot.service';
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
}
