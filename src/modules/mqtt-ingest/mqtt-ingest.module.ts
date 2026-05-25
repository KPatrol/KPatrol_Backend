import { Module, forwardRef } from '@nestjs/common';
import { MqttIngestService } from './mqtt-ingest.service';
import { SocketModule } from '../socket/socket.module';
import { AlarmRuleModule } from '../alarm-rule/alarm-rule.module';
import { NotificationModule } from '../notification/notification.module';

// PrismaModule is global (see PrismaModule.@Global()), so the service can
// inject PrismaService without re-importing it here.
// AlarmRuleModule is imported via forwardRef because the cycle is intentional:
// AlarmRuleService needs to publish via MqttIngestService, and MqttIngestService
// needs AlarmRuleService for startup rule hydration.
// NotificationModule joined V5.15c9: alarm triggers now fan out email/Zalo
// per the AlarmRule.notify* columns immediately after the trigger row is
// persisted in handleAlarmTriggeredMessage().
@Module({
  imports: [SocketModule, forwardRef(() => AlarmRuleModule), NotificationModule],
  providers: [MqttIngestService],
  exports: [MqttIngestService],
})
export class MqttIngestModule {}
