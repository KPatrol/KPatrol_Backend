import { Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { RobotModule } from '../robot/robot.module';

@Module({
  imports: [RobotModule],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule {}
