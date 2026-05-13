/**
 * Idempotent seed: ensures a default admin user + KPATROL-001 robot exist so
 * a fresh DB can be used immediately after `docker compose up`.
 *
 * Default credentials (override via env to avoid baking into git):
 *   SEED_ADMIN_EMAIL    (default: admin@kpatrol.local)
 *   SEED_ADMIN_PASSWORD (default: kpatrol123)
 *   SEED_ADMIN_NAME     (default: K-Patrol Admin)
 *   SEED_ROBOT_SERIAL   (default: KPATROL-001)
 *   SEED_ROBOT_NAME     (default: K-Patrol #1)
 */

import { PrismaClient, Role, RobotStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@kpatrol.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'kpatrol123';
  const name = process.env.SEED_ADMIN_NAME ?? 'K-Patrol Admin';
  const robotSerial = process.env.SEED_ROBOT_SERIAL ?? 'KPATROL-001';
  const robotName = process.env.SEED_ROBOT_NAME ?? 'K-Patrol #1';

  // 1. Upsert admin user (hash password only when creating).
  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, role: Role.ADMIN },
    create: { email, password: hashed, name, role: Role.ADMIN },
  });
  console.log(`[seed] user ready: ${user.email} (${user.id})`);

  // 2. Upsert default robot linked to that user.
  const robot = await prisma.robot.upsert({
    where: { serialNumber: robotSerial },
    update: { userId: user.id, name: robotName },
    create: {
      name: robotName,
      serialNumber: robotSerial,
      status: RobotStatus.OFFLINE,
      userId: user.id,
    },
  });
  console.log(`[seed] robot ready: ${robot.serialNumber} -> user ${user.email}`);
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
