import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'kpatrol-backend',
    };
  }

  @Get()
  root() {
    return {
      name: 'K-Patrol API',
      version: '1.0.0',
      description: 'Hệ sinh thái Robot tuần tra thông minh tích hợp IoT',
      docs: '/api',
    };
  }
}
