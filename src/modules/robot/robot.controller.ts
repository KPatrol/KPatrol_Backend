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
import { CreateRobotDto, UpdateRobotDto } from './robot.dto';

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
    @Body() body: { name: string; routeData?: any },
  ) {
    return this.robotService.createPatrol(id, body.name, body.routeData);
  }
}
