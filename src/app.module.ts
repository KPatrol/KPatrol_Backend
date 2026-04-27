import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { RobotModule } from './modules/robot/robot.module';
import { RobotEventModule } from './modules/robot-event/robot-event.module';
import { SocketModule } from './modules/socket/socket.module';
import { NotificationModule } from './modules/notification/notification.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { SecurityModule } from './modules/security/security.module';
import { UserThrottlerGuard } from './modules/security/user-throttler.guard';
import { SecurityHeadersMiddleware } from './modules/security/security-headers.middleware';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Rate limiting: 60 req/min keyed by user ID when authenticated, else IP.
    // See UserThrottlerGuard for why IP-only breaks behind shared NAT.
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 60,
    }]),
    // Cron scheduler for maintenance tasks
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    RobotModule,
    RobotEventModule,
    SocketModule,
    NotificationModule,
    MaintenanceModule,
    SecurityModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
