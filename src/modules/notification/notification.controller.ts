import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  @Get()
  findAll(
    @Request() req,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    return this.notificationService.findAll(
      req.user.id,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  @Get('unread')
  findUnread(@Request() req) {
    return this.notificationService.findUnread(req.user.id);
  }

  @Get('unread/count')
  countUnread(@Request() req) {
    return this.notificationService.countUnread(req.user.id);
  }

  @Post(':id/read')
  markAsRead(@Request() req, @Param('id') id: string) {
    return this.notificationService.markAsRead(id, req.user.id);
  }

  @Post('read-all')
  markAllAsRead(@Request() req) {
    return this.notificationService.markAllAsRead(req.user.id);
  }

  @Delete(':id')
  delete(@Request() req, @Param('id') id: string) {
    return this.notificationService.delete(id, req.user.id);
  }

  @Delete()
  deleteAll(@Request() req) {
    return this.notificationService.deleteAll(req.user.id);
  }
}
