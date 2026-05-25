import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AlarmRuleService } from './alarm-rule.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateAlarmRuleDto,
  UpdateAlarmRuleDto,
  ALARM_EVENT_TYPES,
  ALARM_LIGHT_PATTERNS,
  ALARM_BUZZER_PATTERNS,
} from './alarm-rule.dto';

@Controller('robots')
@UseGuards(JwtAuthGuard)
export class AlarmRuleController {
  constructor(private readonly service: AlarmRuleService) {}

  // Vocabulary endpoint so the PWA can render dropdowns without hardcoding the
  // Pi-side enums on the client.
  @Get('alarm-rules/vocabulary')
  vocabulary() {
    return {
      eventTypes: ALARM_EVENT_TYPES,
      lightPatterns: ALARM_LIGHT_PATTERNS,
      buzzerPatterns: ALARM_BUZZER_PATTERNS,
    };
  }

  @Get(':id/alarm-rules')
  list(@Request() req, @Param('id') id: string) {
    return this.service.list(id, req.user.id);
  }

  @Post(':id/alarm-rules')
  create(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: CreateAlarmRuleDto,
  ) {
    return this.service.create(id, req.user.id, dto);
  }

  @Put(':id/alarm-rules/:ruleId')
  update(
    @Request() req,
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
    @Body() dto: UpdateAlarmRuleDto,
  ) {
    return this.service.update(id, ruleId, req.user.id, dto);
  }

  @Delete(':id/alarm-rules/:ruleId')
  remove(
    @Request() req,
    @Param('id') id: string,
    @Param('ruleId') ruleId: string,
  ) {
    return this.service.remove(id, ruleId, req.user.id);
  }

  @Get(':id/alarm-triggers')
  listTriggers(
    @Request() req,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 50;
    return this.service.listTriggers(id, req.user.id, Number.isNaN(n) ? 50 : n);
  }
}
