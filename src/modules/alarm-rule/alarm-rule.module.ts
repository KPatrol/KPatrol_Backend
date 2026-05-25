import { Module, forwardRef } from '@nestjs/common';
import { AlarmRuleService } from './alarm-rule.service';
import { AlarmRuleController } from './alarm-rule.controller';
import { MqttIngestModule } from '../mqtt-ingest/mqtt-ingest.module';

// PrismaModule is global. MqttIngest imports us back via forwardRef so its
// trigger-ingest handler can call AlarmRuleService.publishRulesForRobot() on
// startup hydration without a hard cycle at construction time.
@Module({
  imports: [forwardRef(() => MqttIngestModule)],
  providers: [AlarmRuleService],
  controllers: [AlarmRuleController],
  exports: [AlarmRuleService],
})
export class AlarmRuleModule {}
