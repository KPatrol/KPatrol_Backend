import {
  Body,
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

  /**
   * V5.15c9: dispatch a test alert through the full notification pipeline
   * (DB record + email/Zalo fan-out) so the operator can verify SMTP creds
   * and template rendering without waiting for the robot to fire a real
   * alarm. Uses the same code path as a genuine AlarmRule trigger; the
   * only difference is this is initiated by an HTTP call instead of an
   * MQTT alarm/triggered message.
   */
  @Post('test-send')
  async testSend(
    @Request() req,
    @Body() body: { kind?: 'person' | 'fire' | 'motion'; extraEmail?: string },
  ) {
    const kind = body?.kind ?? 'fire';
    const kindLabelVi: Record<string, string> = {
      person: 'Phát hiện người trong khu vực tuần tra',
      fire: 'Cảnh báo: phát hiện lửa/khói',
      motion: 'Phát hiện chuyển động bất thường',
    };
    const messageVi = `${kindLabelVi[kind] ?? 'Sự kiện cảnh báo'} (đây là thông báo thử nghiệm từ giao diện cockpit).`;
    const extra =
      body?.extraEmail && body.extraEmail.includes('@')
        ? [body.extraEmail]
        : [];
    await this.notificationService.notifyForAlarmRule(
      req.user.id,
      kind,
      messageVi,
      {
        notifyOwner: true,
        notifyAdmins: false,
        extraEmails: extra,
      },
    );
    return { ok: true, kind, dispatchedTo: 'owner + extra (if provided)' };
  }

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
