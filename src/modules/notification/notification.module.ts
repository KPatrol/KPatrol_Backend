import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { EmailChannel } from './channels/email.channel';
import { ZaloChannel } from './channels/zalo.channel';

@Module({
  providers: [NotificationService, EmailChannel, ZaloChannel],
  controllers: [NotificationController],
  exports: [NotificationService],
})
export class NotificationModule {}
