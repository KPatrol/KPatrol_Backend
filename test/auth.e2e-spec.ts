import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Kiểm thử tích hợp đầu cuối (e2e) luồng xác thực — chạy trên ngăn xếp THẬT
 * dựng bằng Docker Compose (PostgreSQL, Redis, EMQX). Bao phủ: đăng ký, đăng
 * nhập, xác minh phiếu, làm mới (xoay vòng), đăng xuất và bảo vệ route.
 *
 * Yêu cầu: biến môi trường .env trỏ tới CSDL test; chạy `docker compose up -d`
 * trước khi `npm run test:e2e`.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  const email = `e2e_${Date.now()}@kpatrol.test`;
  const password = 'E2e@Secret123';
  let refreshToken: string;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('POST /api/auth/register tạo tài khoản và trả cặp phiếu', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: 'E2E User' })
      .expect(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.password).toBeUndefined();
  });

  it('POST /api/auth/register trùng email → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email, password, name: 'Dup' })
      .expect(409);
  });

  it('POST /api/auth/login đúng thông tin → 200 + phiếu', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
    expect(accessToken).toBeDefined();
  });

  it('POST /api/auth/login sai mật khẩu → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'wrong' })
      .expect(401);
  });

  it('POST /api/auth/login email không tồn tại → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'ghost@kpatrol.test', password })
      .expect(401);
  });

  it('GET /api/auth/verify với phiếu hợp lệ → 200', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/verify')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('GET /api/auth/verify thiếu phiếu → 401', async () => {
    await request(app.getHttpServer()).get('/api/auth/verify').expect(401);
  });

  it('GET /api/auth/me trả hồ sơ người dùng', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.email).toBe(email);
  });

  it('POST /api/auth/refresh xoay vòng phiếu', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).not.toBe(refreshToken); // đã xoay vòng
    refreshToken = res.body.refreshToken;
  });

  it('POST /api/auth/refresh thiếu token → 401', async () => {
    await request(app.getHttpServer()).post('/api/auth/refresh').send({}).expect(401);
  });

  it('POST /api/auth/refresh token không hợp lệ → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'không-tồn-tại' })
      .expect(401);
  });

  it('POST /api/auth/logout luôn trả success', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken })
      .expect(200);
    expect(res.body.success).toBe(true);
  });

  it('phiếu làm mới đã thu hồi không dùng lại được → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });
});
