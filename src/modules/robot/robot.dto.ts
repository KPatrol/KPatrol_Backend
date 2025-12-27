import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateRobotDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  firmwareVersion?: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
}

export class UpdateRobotDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  firmwareVersion?: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, any>;
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
