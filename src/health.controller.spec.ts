import { HealthController } from './health.controller';

/**
 * Unit test cho HealthController — probe liveness công khai dùng cho Docker
 * healthcheck và proxy ngược. Phải giữ ổn định, không chạm cơ sở dữ liệu.
 */
describe('HealthController', () => {
  const controller = new HealthController();

  it('health() trả status ok và tên dịch vụ', () => {
    const res = controller.health();
    expect(res.status).toBe('ok');
    expect(res.service).toBe('kpatrol-backend');
    expect(typeof res.timestamp).toBe('string');
  });

  it('root() trả siêu dữ liệu API', () => {
    const res = controller.root();
    expect(res.name).toBe('K-Patrol API');
    expect(res.docs).toBe('/api');
  });
});
