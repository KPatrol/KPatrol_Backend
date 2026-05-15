import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RobotEventService } from './robot-event.service';
import { CreateRobotEventDto } from './robot-event.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

/**
 * RobotEvent Controller — requires JWT (locked down 2026-05-15).
 * Caller must own the robot identified by `robotSerial` (verified inside
 * the service via Robot.userId). Rate-limited at 30 writes/min, 120 reads/min.
 */
@Controller('robot-events')
@UseGuards(JwtAuthGuard)
export class RobotEventController {
  constructor(private robotEventService: RobotEventService) {}

  /**
   * POST /api/robot-events
   * Log a new robot event — stricter rate limit (30/min)
   */
  @Post()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  create(@Request() req, @Body() dto: CreateRobotEventDto) {
    return this.robotEventService.createEvent(
      dto.robotSerial,
      req.user.id,
      dto.eventType,
      dto.title,
      dto.description,
      dto.severity ?? 'info',
      dto.data,
    );
  }

  /**
   * GET /api/robot-events?robotSerial=X&eventType=Y&page=1&limit=50
   * Get paginated history of events
   */
  @Get()
  getEvents(
    @Request() req,
    @Query('robotSerial') robotSerial: string,
    @Query('eventType') eventType?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.robotEventService.getEvents(
      robotSerial,
      req.user.id,
      eventType,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  /**
   * GET /api/robot-events/stats?robotSerial=X
   * Get event count statistics
   */
  @Get('stats')
  getStats(@Request() req, @Query('robotSerial') robotSerial: string) {
    return this.robotEventService.getStats(robotSerial, req.user.id);
  }

  /**
   * DELETE /api/robot-events?robotSerial=X
   * Clear all events for a robot
   */
  @Delete()
  clearAll(@Request() req, @Query('robotSerial') robotSerial: string) {
    return this.robotEventService.clearEvents(robotSerial, req.user.id);
  }

  /**
   * DELETE /api/robot-events/:id?robotSerial=X
   * Delete a single event
   */
  @Delete(':id')
  deleteOne(
    @Request() req,
    @Param('id') id: string,
    @Query('robotSerial') robotSerial: string,
  ) {
    return this.robotEventService.deleteEvent(id, robotSerial, req.user.id);
  }
}
