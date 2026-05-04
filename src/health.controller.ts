import { Controller, Get } from '@nestjs/common';

/**
 * Public, unauthenticated probes for liveness checks and API discovery.
 * Used by Docker healthcheck, the reverse proxy, and uptime monitors — keep the
 * response shape stable and the implementation dependency-free so a failing DB
 * or auth provider never takes the health endpoint down with it.
 */
@Controller()
export class HealthController {
  /**
   * Liveness probe. Returns 200 as long as the Nest event loop is responsive.
   * Intentionally does NOT touch the database or any downstream service —
   * a "ready" probe with deeper checks belongs in a separate endpoint.
   */
  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'kpatrol-backend',
    };
  }

  /**
   * Root metadata endpoint — humans hitting the bare API URL get a hint
   * that this is the K-Patrol backend and where to find the API prefix.
   */
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
