import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RobotService } from './robot.service';
import { RobotController } from './robot.controller';
import { getStreamTokenSecret } from '../../config/auth.config';

@Module({
  imports: [
    JwtModule.register({
      secret: getStreamTokenSecret(),
    }),
  ],
  providers: [RobotService],
  controllers: [RobotController],
  exports: [RobotService],
})
export class RobotModule {}
