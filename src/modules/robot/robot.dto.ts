import { IsString, IsOptional, IsObject, IsBoolean, IsNumber, Min, Max } from 'class-validator';

export class CreateRobotDto {
  @IsString()
  name: string;

  @IsString()
  serialNumber: string;
}

export class UpdateRobotDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;
}

export class UpdateRobotConfigDto {
  @IsBoolean()
  @IsOptional()
  safetyEnabled?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(50)
  @Max(500)
  dangerDistance?: number;

  @IsNumber()
  @IsOptional()
  @Min(100)
  @Max(800)
  cautionDistance?: number;

  @IsNumber()
  @IsOptional()
  @Min(200)
  @Max(1500)
  slowDistance?: number;

  @IsNumber()
  @IsOptional()
  @Min(50)
  @Max(255)
  defaultSpeed?: number;

  @IsString()
  @IsOptional()
  name?: string;
}

export class CreatePatrolDto {
  @IsString()
  name: string;

  @IsObject()
  @IsOptional()
  routeData?: Record<string, any>;
}

export class CreateAlertDto {
  @IsString()
  type: string;

  @IsString()
  severity: string;

  @IsString()
  message: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}
