import { Module } from '@nestjs/common';
import { RobotEventController } from './robot-event.controller';
import { RobotEventService } from './robot-event.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, NotificationModule],
  controllers: [RobotEventController],
  providers: [RobotEventService],
  exports: [RobotEventService],
})
export class RobotEventModule {}
