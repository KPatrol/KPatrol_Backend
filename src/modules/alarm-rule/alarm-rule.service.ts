import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Prisma, AlarmRule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MqttIngestService } from '../mqtt-ingest/mqtt-ingest.service';
import { CreateAlarmRuleDto, UpdateAlarmRuleDto } from './alarm-rule.dto';

/**
 * Operator-configured alarm rules. Each rule maps an event-type (person / fire /
 * battery_low / battery_critical / tipover / schedule / system_error /
 * any_safety) onto a light+buzzer pattern that fires after the event has been
 * continuously observed for `continuousDurationS` inside one of the configured
 * time windows.
 *
 * On every CRUD, the *full* rule set for that robot is republished to MQTT
 * (`kpatrol/{serial}/alarm/rules`, retained=true). The Pi-side AlarmController
 * replaces its in-memory rule set wholesale, so we don't need a partial-update
 * protocol or rule-id tracking on the Pi.
 */
@Injectable()
export class AlarmRuleService {
  private readonly logger = new Logger('AlarmRuleService');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MqttIngestService))
    private readonly mqtt: MqttIngestService,
  ) {}

  async list(robotId: string, userId: string): Promise<AlarmRule[]> {
    await this.assertOwnership(robotId, userId);
    return this.prisma.alarmRule.findMany({
      where: { robotId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(
    robotId: string,
    userId: string,
    dto: CreateAlarmRuleDto,
  ): Promise<AlarmRule> {
    await this.assertOwnership(robotId, userId);
    const rule = await this.prisma.alarmRule.create({
      data: {
        robotId,
        name: dto.name,
        eventType: dto.eventType,
        enabled: dto.enabled ?? true,
        continuousDurationS: dto.continuousDurationS ?? 15,
        cooldownS: dto.cooldownS ?? 30,
        lightPattern: dto.lightPattern ?? 'WARN_BLINK',
        buzzerPattern: dto.buzzerPattern ?? 'ALARM',
        windows: (dto.windows ?? []) as unknown as Prisma.InputJsonValue,
        // V5.15c9: notification toggles. notifyOwner defaults true so a
        // freshly-created rule still pings the operator without requiring
        // the UI to toggle anything explicitly.
        notifyOwner: dto.notifyOwner ?? true,
        notifyAdmins: dto.notifyAdmins ?? false,
        notifyEmail: dto.notifyEmail ?? null,
        notifyZaloIds: (dto.notifyZaloIds ?? []) as unknown as Prisma.InputJsonValue,
      },
    });
    await this.republish(robotId);
    return rule;
  }

  async update(
    robotId: string,
    ruleId: string,
    userId: string,
    dto: UpdateAlarmRuleDto,
  ): Promise<AlarmRule> {
    await this.assertOwnership(robotId, userId);
    const existing = await this.prisma.alarmRule.findUnique({
      where: { id: ruleId },
    });
    if (!existing) throw new NotFoundException('Alarm rule not found');
    if (existing.robotId !== robotId) {
      throw new ForbiddenException('Rule does not belong to this robot');
    }

    const data: Prisma.AlarmRuleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.eventType !== undefined) data.eventType = dto.eventType;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    if (dto.continuousDurationS !== undefined)
      data.continuousDurationS = dto.continuousDurationS;
    if (dto.cooldownS !== undefined) data.cooldownS = dto.cooldownS;
    if (dto.lightPattern !== undefined) data.lightPattern = dto.lightPattern;
    if (dto.buzzerPattern !== undefined) data.buzzerPattern = dto.buzzerPattern;
    if (dto.windows !== undefined) {
      data.windows = dto.windows as unknown as Prisma.InputJsonValue;
    }
    if (dto.notifyOwner !== undefined) data.notifyOwner = dto.notifyOwner;
    if (dto.notifyAdmins !== undefined) data.notifyAdmins = dto.notifyAdmins;
    if (dto.notifyEmail !== undefined) data.notifyEmail = dto.notifyEmail;
    if (dto.notifyZaloIds !== undefined) {
      data.notifyZaloIds = dto.notifyZaloIds as unknown as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.alarmRule.update({
      where: { id: ruleId },
      data,
    });
    await this.republish(robotId);
    return updated;
  }

  async remove(
    robotId: string,
    ruleId: string,
    userId: string,
  ): Promise<AlarmRule> {
    await this.assertOwnership(robotId, userId);
    const existing = await this.prisma.alarmRule.findUnique({
      where: { id: ruleId },
    });
    if (!existing) throw new NotFoundException('Alarm rule not found');
    if (existing.robotId !== robotId) {
      throw new ForbiddenException('Rule does not belong to this robot');
    }
    const deleted = await this.prisma.alarmRule.delete({
      where: { id: ruleId },
    });
    await this.republish(robotId);
    return deleted;
  }

  async listTriggers(
    robotId: string,
    userId: string,
    limit = 50,
  ): Promise<unknown[]> {
    await this.assertOwnership(robotId, userId);
    return this.prisma.alarmTrigger.findMany({
      where: { robotId },
      orderBy: { firedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  /**
   * Fetch every rule for the robot, look up the serial, and republish the full
   * list to `kpatrol/{serial}/alarm/rules` as a retained payload. Called from
   * MqttIngestService on startup (rule hydration) and after every CRUD here.
   */
  async publishRulesForRobot(robotId: string): Promise<void> {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { serialNumber: true },
    });
    if (!robot) return;
    const rules = await this.prisma.alarmRule.findMany({
      where: { robotId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    // Wire format matches AlarmController.update_rules() on the Pi.
    const payload = {
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        event_type: r.eventType,
        enabled: r.enabled,
        continuous_duration_s: r.continuousDurationS,
        cooldown_s: r.cooldownS,
        light_pattern: r.lightPattern,
        buzzer_pattern: r.buzzerPattern,
        windows: r.windows ?? [],
      })),
      ts: Date.now() / 1000,
    };
    this.mqtt.publishAlarmRules(robot.serialNumber, payload);
  }

  private async republish(robotId: string): Promise<void> {
    try {
      await this.publishRulesForRobot(robotId);
    } catch (err) {
      this.logger.warn(
        `republish failed for ${robotId}: ${(err as Error).message}`,
      );
    }
  }

  private async assertOwnership(
    robotId: string,
    userId: string,
  ): Promise<void> {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: { userId: true },
    });
    if (!robot) throw new NotFoundException('Robot not found');
    if (robot.userId !== userId) {
      throw new ForbiddenException('Access denied');
    }
  }
}
