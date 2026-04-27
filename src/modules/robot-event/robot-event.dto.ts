import { IsString, IsOptional, IsObject, IsEnum, IsNumber, Min, Max } from 'class-validator';

export class CreateRobotEventDto {
  @IsString()
  robotSerial: string;  // Robot serial number as lightweight auth

  @IsString()
  @IsEnum(['movement', 'alert', 'system', 'patrol', 'connection', 'error', 'safety', 'navigation'])
  eventType: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsString()
  @IsOptional()
  @IsEnum(['info', 'success', 'warning', 'error'])
  severity?: string;

  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}

export class GetRobotEventsDto {
  @IsString()
  robotSerial: string;

  @IsString()
  @IsOptional()
  eventType?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  page?: number;

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(200)
  limit?: number;
}
