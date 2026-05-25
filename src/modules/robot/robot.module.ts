import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RobotService } from './robot.service';
import { RobotController } from './robot.controller';
import { MqttIngestModule } from '../mqtt-ingest/mqtt-ingest.module';
import { getStreamTokenSecret } from '../../config/auth.config';

@Module({
  imports: [
    JwtModule.register({
      secret: getStreamTokenSecret(),
    }),
    // V5.6: peripheral commands (warning light/horn relay, OLED text) go
    // out via MQTT, so the controller needs MqttIngestService injected.
    // forwardRef in case MqttIngest grows back-references to RobotModule.
    forwardRef(() => MqttIngestModule),
  ],
  providers: [RobotService],
  controllers: [RobotController],
  exports: [RobotService],
})
export class RobotModule {}
