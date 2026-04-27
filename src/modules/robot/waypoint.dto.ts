import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
  ValidateNested,
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Script / patrol waypoint schema.
 *
 * Defines what the Pi will accept as a queued path — enforcing sane bounds
 * here means the robot never sees a command that asks it to rotate 1e9 rad
 * or translate 100 km. These bounds match the firmware's physical envelope:
 *
 *   - distance:  0–20 m   (room-scale; enforced by nav executor anyway)
 *   - rotation:  ±2π rad  (prefer unwrapped headings; executor re-wraps)
 *   - speed:     0–255    (BTS7960 PWM duty; 255 = full-scale)
 *   - timeout:   1–120 s  (per-step; detector stalls shorter than this)
 *
 * Steps are capped at 256 to keep a single request payload under the
 * nginx default body limit and to avoid OOM in the Pi's patrol state.
 */

export enum WaypointKind {
  MOVE = 'move',     // translate vx/vy body-frame
  ROTATE = 'rotate', // yaw to absolute heading
  STOP = 'stop',     // dwell with motors idle
}

export class WaypointStepDto {
  @IsEnum(WaypointKind)
  kind: WaypointKind;

  @IsOptional()
  @IsNumber()
  @Min(-20)
  @Max(20)
  distanceM?: number;

  @IsOptional()
  @IsNumber()
  @Min(-Math.PI * 2)
  @Max(Math.PI * 2)
  headingRad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(255)
  speedPwm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(120)
  dwellSec?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(120)
  timeoutSec?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  note?: string;
}

export class CreateScriptPatrolDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsBoolean()
  loop?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(256)
  @ValidateNested({ each: true })
  @Type(() => WaypointStepDto)
  steps: WaypointStepDto[];
}
