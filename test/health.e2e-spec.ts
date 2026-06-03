import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * Kiểm thử tích hợp đầu cuối (e2e) cho probe sức khoẻ công khai — không yêu cầu
 * xác thực, dùng cho Docker healthcheck và proxy ngược.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /api/health → 200 status ok (không cần phiếu)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('kpatrol-backend');
  });

  it('GET /api → siêu dữ liệu API', async () => {
    const res = await request(app.getHttpServer()).get('/api').expect(200);
    expect(res.body.name).toBe('K-Patrol API');
  });

  it('GET route không tồn tại → 404', async () => {
    await request(app.getHttpServer()).get('/api/khong-ton-tai').expect(404);
  });
});
