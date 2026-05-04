import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SocketGateway } from './socket.gateway';
import { RobotModule } from '../robot/robot.module';
import { getJwtSecret } from '../../config/auth.config';

@Module({
  imports: [
    RobotModule,
    JwtModule.register({
      secret: getJwtSecret(),
    }),
  ],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule {}
