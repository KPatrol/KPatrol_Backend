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
import { RobotService } from './robot.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateRobotDto, UpdateRobotDto, UpdateRobotConfigDto } from './robot.dto';
import { CreateScriptPatrolDto } from './waypoint.dto';

@Controller('robots')
@UseGuards(JwtAuthGuard)
export class RobotController {
  constructor(private robotService: RobotService) {}

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
  getAlerts(@Param('id') id: string) {
    return this.robotService.getActiveAlerts(id);
  }

  @Put('alerts/:alertId/acknowledge')
  acknowledgeAlert(@Param('alertId') alertId: string) {
    return this.robotService.acknowledgeAlert(alertId);
  }

  @Post(':id/patrol')
  createPatrol(
    @Param('id') id: string,
    @Body() dto: CreateScriptPatrolDto,
  ) {
    return this.robotService.createPatrol(id, dto.name, {
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
    @Param('patrolId') patrolId: string,
    @Body() body: { status: string },
  ) {
    return this.robotService.updatePatrolStatus(patrolId, body.status);
  }

  @Delete(':id/patrols/:patrolId')
  deletePatrol(@Param('patrolId') patrolId: string) {
    return this.robotService.deletePatrol(patrolId);
  }
}
