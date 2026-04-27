import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto, LoginDto } from './auth.dto';

const REFRESH_TOKEN_BYTES = 48;
const REFRESH_TTL_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
      },
    });

    const accessToken  = this.generateAccessToken(user.id);
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      accessToken,
      refreshToken,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('Invalid credentials');

    const accessToken  = this.generateAccessToken(user.id);
    const refreshToken = await this.createRefreshToken(user.id);

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      accessToken,
      refreshToken,
    };
  }

  async validateUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true },
    });
  }

  /** Verify that an access token is valid — returns user payload or null. */
  async verifyAccessToken(token: string) {
    try {
      const payload = this.jwtService.verify<{ sub: string }>(token);
      return this.validateUser(payload.sub);
    } catch {
      return null;
    }
  }

  /** Exchange a valid refresh token for a new access + refresh token pair. */
  async refresh(rawToken: string) {
    const session = await this.prisma.authSession.findUnique({
      where: { token: rawToken },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      // Delete expired session if found
      if (session) {
        await this.prisma.authSession.delete({ where: { id: session.id } });
      }
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    // Rotate: delete old, issue new pair
    await this.prisma.authSession.delete({ where: { id: session.id } });

    const accessToken  = this.generateAccessToken(session.userId);
    const refreshToken = await this.createRefreshToken(session.userId);
    const { user } = session;

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      accessToken,
      refreshToken,
    };
  }

  /** Invalidate a refresh token (logout). */
  async revokeRefreshToken(rawToken: string) {
    await this.prisma.authSession.deleteMany({ where: { token: rawToken } });
  }

  private generateAccessToken(userId: string): string {
    return this.jwtService.sign({ sub: userId });
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const raw = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TTL_DAYS);

    await this.prisma.authSession.create({
      data: { userId, token: raw, expiresAt },
    });

    return raw;
  }
}
