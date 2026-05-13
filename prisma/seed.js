/**
 * Plain-JS seed for production container (no ts-node needed).
 * Idempotent: ensures default admin user + KPATROL-001 robot exist.
 *
 * Override defaults via env vars: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD,
 * SEED_ADMIN_NAME, SEED_ROBOT_SERIAL, SEED_ROBOT_NAME.
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kpatrol.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'kpatrol123';
  const name = process.env.SEED_ADMIN_NAME || 'K-Patrol Admin';
  const robotSerial = process.env.SEED_ROBOT_SERIAL || 'KPATROL-001';
  const robotName = process.env.SEED_ROBOT_NAME || 'K-Patrol #1';

  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, role: 'ADMIN' },
    create: { email, password: hashed, name, role: 'ADMIN' },
  });
  console.log(`[seed] user ready: ${user.email} (${user.id})`);

  const robot = await prisma.robot.upsert({
    where: { serialNumber: robotSerial },
    update: { userId: user.id, name: robotName },
    create: {
      name: robotName,
      serialNumber: robotSerial,
      status: 'OFFLINE',
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
  .finally(() => prisma.$disconnect());
