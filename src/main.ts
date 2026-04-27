import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // CORS — allow local dev + production subdomains
  const corsOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:8001',
      'http://localhost:3001',
      'http://localhost:8002',
      'https://kpatrol.khoavd.online',
      'https://monitor.khoavd.online',
      ...corsOrigins,
    ],
    credentials: true,
  });

  // Validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // Prefix
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3002;
  await app.listen(port);
  
  console.log(`🚀 K-Patrol Backend running on http://localhost:${port}`);
  console.log(`📡 API prefix: /api`);
}

bootstrap();
