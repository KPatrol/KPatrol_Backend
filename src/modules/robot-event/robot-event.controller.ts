import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RobotEventService } from './robot-event.service';
import { CreateRobotEventDto } from './robot-event.dto';

/**
 * RobotEvent Controller — PUBLIC endpoint (no JWT required)
 * Authentication: robot serial number passed in request body/query
 * Rate limited: 30 writes/min, 120 reads/min per IP
 */
@Controller('robot-events')
export class RobotEventController {
  constructor(private robotEventService: RobotEventService) {}

  /**
   * POST /api/robot-events
   * Log a new robot event — stricter rate limit (30/min)
   */
  @Post()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  create(@Body() dto: CreateRobotEventDto) {
    return this.robotEventService.createEvent(
      dto.robotSerial,
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
    @Query('robotSerial') robotSerial: string,
    @Query('eventType') eventType?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    return this.robotEventService.getEvents(
      robotSerial,
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
  getStats(@Query('robotSerial') robotSerial: string) {
    return this.robotEventService.getStats(robotSerial);
  }

  /**
   * DELETE /api/robot-events?robotSerial=X
   * Clear all events for a robot
   */
  @Delete()
  clearAll(@Query('robotSerial') robotSerial: string) {
    return this.robotEventService.clearEvents(robotSerial);
  }

  /**
   * DELETE /api/robot-events/:id?robotSerial=X
   * Delete a single event
   */
  @Delete(':id')
  deleteOne(
    @Param('id') id: string,
    @Query('robotSerial') robotSerial: string,
  ) {
    return this.robotEventService.deleteEvent(id, robotSerial);
  }
}
