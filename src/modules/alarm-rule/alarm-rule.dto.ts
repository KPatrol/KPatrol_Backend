import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Vocabulary mirrors `safety/alarm_controller.py` on the Pi. Keep these in sync —
// the Pi rejects unknown event types so an out-of-vocab string from the UI would
// silently no-op without surfacing a validation error.
const EVENT_TYPES = [
  'person',
  'fire',
  'battery_low',
  'battery_critical',
  'tipover',
  'schedule',
  'system_error',
  'any_safety',
] as const;

const LIGHT_PATTERNS = [
  'OFF',
  'WARN_BLINK',
  'WARN_STROBE',
  'BOTH_BLINK',
  'SOS',
] as const;

const BUZZER_PATTERNS = ['OFF', 'ON', 'BEEP', 'ALARM', 'SOS'] as const;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class TimeWindowDto {
  @Matches(TIME_RE, { message: 'start must be HH:MM (24h)' })
  start: string;

  @Matches(TIME_RE, { message: 'end must be HH:MM (24h)' })
  end: string;

  // Sunday=0 … Saturday=6, matches Python datetime.weekday() with our own
  // remapping (Pi side). Empty means "every day".
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays: number[];
}

export class CreateAlarmRuleDto {
  @IsString()
  name: string;

  @IsIn(EVENT_TYPES as unknown as string[])
  eventType: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsInt()
  @Min(1)
  @Max(300)
  @IsOptional()
  continuousDurationS?: number;

  @IsInt()
  @Min(0)
  @Max(3600)
  @IsOptional()
  cooldownS?: number;

  @IsIn(LIGHT_PATTERNS as unknown as string[])
  @IsOptional()
  lightPattern?: string;

  @IsIn(BUZZER_PATTERNS as unknown as string[])
  @IsOptional()
  buzzerPattern?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimeWindowDto)
  @IsOptional()
  windows?: TimeWindowDto[];

  // ── V5.15c9: notification dispatch fields ────────────────────────
  @IsBoolean()
  @IsOptional()
  notifyOwner?: boolean;

  @IsBoolean()
  @IsOptional()
  notifyAdmins?: boolean;

  @IsString()
  @IsOptional()
  notifyEmail?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  notifyZaloIds?: string[];
}

export class UpdateAlarmRuleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsIn(EVENT_TYPES as unknown as string[])
  @IsOptional()
  eventType?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsInt()
  @Min(1)
  @Max(300)
  @IsOptional()
  continuousDurationS?: number;

  @IsInt()
  @Min(0)
  @Max(3600)
  @IsOptional()
  cooldownS?: number;

  @IsIn(LIGHT_PATTERNS as unknown as string[])
  @IsOptional()
  lightPattern?: string;

  @IsIn(BUZZER_PATTERNS as unknown as string[])
  @IsOptional()
  buzzerPattern?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimeWindowDto)
  @IsOptional()
  windows?: TimeWindowDto[];

  // ── V5.15c9: notification dispatch fields ────────────────────────
  @IsBoolean()
  @IsOptional()
  notifyOwner?: boolean;

  @IsBoolean()
  @IsOptional()
  notifyAdmins?: boolean;

  @IsString()
  @IsOptional()
  notifyEmail?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  notifyZaloIds?: string[];
}

export const ALARM_EVENT_TYPES = EVENT_TYPES;
export const ALARM_LIGHT_PATTERNS = LIGHT_PATTERNS;
export const ALARM_BUZZER_PATTERNS = BUZZER_PATTERNS;
