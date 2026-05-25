import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SocketGateway } from './socket.gateway';
import { RobotModule } from '../robot/robot.module';
import { getJwtSecret } from '../../config/auth.config';

// V5.6: a 3-module ring exists now —
//   RobotModule → MqttIngestModule → SocketModule → RobotModule
// so this side has to import RobotModule via forwardRef. Without it Nest
// resolves RobotModule to `undefined` here and bootstrap fails.
@Module({
  imports: [
    forwardRef(() => RobotModule),
    JwtModule.register({
      secret: getJwtSecret(),
    }),
  ],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule {}
