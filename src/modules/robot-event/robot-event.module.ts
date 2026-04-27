import { Module } from '@nestjs/common';
import { RobotEventController } from './robot-event.controller';
import { RobotEventService } from './robot-event.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RobotEventController],
  providers: [RobotEventService],
  exports: [RobotEventService],
})
export class RobotEventModule {}
