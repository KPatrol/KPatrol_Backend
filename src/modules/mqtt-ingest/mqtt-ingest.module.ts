import { Module } from '@nestjs/common';
import { MqttIngestService } from './mqtt-ingest.service';
import { SocketModule } from '../socket/socket.module';

// PrismaModule is global (see PrismaModule.@Global()), so the service can
// inject PrismaService without re-importing it here.
@Module({
  imports: [SocketModule],
  providers: [MqttIngestService],
})
export class MqttIngestModule {}
