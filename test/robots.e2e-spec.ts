import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Kiểm thử tích hợp đầu cuối (e2e) quản lý robot + kiểm soát sở hữu (RBAC).
 * Dựng hai người dùng để xác minh người dùng A không truy cập được robot của
 * người dùng B. Chạy trên ngăn xếp thật (Docker Compose).
 */
describe('Robots (e2e)', () => {
  let app: INestApplication;
  const ts = Date.now();
  const userA = { email: `a_${ts}@kpatrol.test`, password: 'A@secret123', name: 'User A' };
  const userB = { email: `b_${ts}@kpatrol.test`, password: 'B@secret123', name: 'User B' };
  let tokenA = '';
  let tokenB = '';
  let robotId = '';

  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const ra = await http().post('/api/auth/register').send(userA);
    tokenA = ra.body.accessToken;
    const rb = await http().post('/api/auth/register').send(userB);
    tokenB = rb.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/robots thiếu phiếu → 401', async () => {
    await http().get('/api/robots').expect(401);
  });

  it('POST /api/robots tạo robot cho người dùng A', async () => {
    const res = await http()
      .post('/api/robots')
      .set(auth(tokenA))
      .send({ name: 'Robot A', serialNumber: `KP-${ts}` })
      .expect(201);
    robotId = res.body.id;
    expect(res.body.name).toBe('Robot A');
  });

  it('GET /api/robots liệt kê robot của A', async () => {
    const res = await http().get('/api/robots').set(auth(tokenA)).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((r: any) => r.id === robotId)).toBe(true);
  });

  it('GET /api/robots/:id trả chi tiết cho chủ sở hữu', async () => {
    const res = await http().get(`/api/robots/${robotId}`).set(auth(tokenA)).expect(200);
    expect(res.body.id).toBe(robotId);
  });

  it('GET /api/robots/:id của A bởi B → 403', async () => {
    await http().get(`/api/robots/${robotId}`).set(auth(tokenB)).expect(403);
  });

  it('GET /api/robots/:id không tồn tại → 404', async () => {
    await http().get('/api/robots/khong-ton-tai').set(auth(tokenA)).expect(404);
  });

  it('PUT /api/robots/:id cập nhật bởi chủ sở hữu', async () => {
    const res = await http()
      .put(`/api/robots/${robotId}`)
      .set(auth(tokenA))
      .send({ name: 'Robot A đổi tên' })
      .expect(200);
    expect(res.body.name).toBe('Robot A đổi tên');
  });

  it('PUT /api/robots/:id bởi B → 403', async () => {
    await http().put(`/api/robots/${robotId}`).set(auth(tokenB)).send({ name: 'hack' }).expect(403);
  });

  it('GET /api/robots/:id/config trả cấu hình (không lộ userId)', async () => {
    const res = await http().get(`/api/robots/${robotId}/config`).set(auth(tokenA)).expect(200);
    expect(res.body.userId).toBeUndefined();
  });

  it('POST /api/robots/:id/patrol tạo tuyến tuần tra', async () => {
    await http()
      .post(`/api/robots/${robotId}/patrol`)
      .set(auth(tokenA))
      .send({ name: 'Tuyến đêm', loop: true, steps: [] })
      .expect(201);
  });

  it('GET /api/robots/:id/patrols liệt kê tuyến', async () => {
    const res = await http().get(`/api/robots/${robotId}/patrols`).set(auth(tokenA)).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/robots/:id/alarm-rules trả danh sách (rỗng ban đầu)', async () => {
    const res = await http().get(`/api/robots/${robotId}/alarm-rules`).set(auth(tokenA)).expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('DELETE /api/robots/:id bởi B → 403 (không xoá được của người khác)', async () => {
    await http().delete(`/api/robots/${robotId}`).set(auth(tokenB)).expect(403);
  });

  it('DELETE /api/robots/:id bởi chủ sở hữu → 200', async () => {
    await http().delete(`/api/robots/${robotId}`).set(auth(tokenA)).expect(200);
  });
});
