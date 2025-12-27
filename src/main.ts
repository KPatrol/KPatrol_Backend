import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // CORS
  app.enableCors({
    origin: [
      'http://localhost:3000', // Mobile App
      'http://localhost:3001', // Web Commerce
    ],
    credentials: true,
  });

  // Validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  // Prefix
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3002;
  await app.listen(port);
  
  console.log(`🚀 K-Patrol Backend running on http://localhost:${port}`);
  console.log(`📡 WebSocket Gateway on ws://localhost:${port}`);
}

bootstrap();
