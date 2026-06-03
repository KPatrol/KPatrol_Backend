import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Kiểm thử tích hợp đầu cuối (e2e) cho hộp thư thông báo — phân trang, đếm
 * chưa đọc, đánh dấu đã đọc và xoá. Mọi route yêu cầu JWT của đúng người dùng.
 */
describe('Notifications (e2e)', () => {
  let app: INestApplication;
  const user = { email: `noti_${Date.now()}@kpatrol.test`, password: 'N@secret123', name: 'Noti' };
  let token = '';
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const r = await http().post('/api/auth/register').send(user);
    token = r.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/notifications thiếu phiếu → 401', async () => {
    await http().get('/api/notifications').expect(401);
  });

  it('GET /api/notifications trả cấu trúc phân trang', async () => {
    const res = await http().get('/api/notifications?page=1&limit=20').set(auth()).expect(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('totalPages');
  });

  it('GET /api/notifications/unread trả mảng', async () => {
    const res = await http().get('/api/notifications/unread').set(auth()).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/notifications/unread/count trả số', async () => {
    const res = await http().get('/api/notifications/unread/count').set(auth()).expect(200);
    expect(typeof res.body === 'number' || typeof res.body.count !== 'undefined').toBe(true);
  });

  it('POST /api/notifications/read-all → 200/201', async () => {
    await http().post('/api/notifications/read-all').set(auth()).expect((res) => {
      if (![200, 201].includes(res.status)) throw new Error(`status ${res.status}`);
    });
  });

  it('DELETE /api/notifications xoá toàn bộ của người dùng', async () => {
    await http().delete('/api/notifications').set(auth()).expect(200);
  });
});
