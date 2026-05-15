// Pure-JS sibling of assign-robot-owner.ts — runs in the prod image where
// ts-node is not installed. Usage inside container:
//   OWNER_EMAIL=... OWNER_PASSWORD=... OWNER_NAME=... ROBOT_SERIAL=... \
//     node /tmp/assign-robot-owner.mjs

import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[ops] missing required env ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const email = required('OWNER_EMAIL');
  const password = required('OWNER_PASSWORD');
  const name = process.env.OWNER_NAME ?? email.split('@')[0];
  const robotSerial = process.env.ROBOT_SERIAL ?? 'KPATROL-001';
  const makeAdmin = (process.env.MAKE_ADMIN ?? 'true').toLowerCase() !== 'false';
  const role = makeAdmin ? Role.ADMIN : Role.USER;
  const forceReset = process.env.FORCE_RESET_PASSWORD === 'true';

  const existing = await prisma.user.findUnique({ where: { email } });
  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, role, ...(forceReset ? { password: hashed } : {}) },
    create: { email, password: hashed, name, role },
  });
  console.log(`[ops] user ${existing ? 'updated' : 'created'}: ${user.email} (id=${user.id}, role=${user.role})`);

  const robot = await prisma.robot.findUnique({ where: { serialNumber: robotSerial } });
  if (!robot) {
    console.error(`[ops] robot ${robotSerial} NOT FOUND — run seed or check serial`);
    process.exit(2);
  }

  if (robot.userId === user.id) {
    console.log(`[ops] robot ${robot.serialNumber} already owned by ${user.email}`);
  } else {
    const old = await prisma.user.findUnique({ where: { id: robot.userId } });
    await prisma.robot.update({ where: { id: robot.id }, data: { userId: user.id } });
    console.log(`[ops] robot ${robot.serialNumber}: ${old?.email ?? robot.userId} -> ${user.email}`);
  }

  const visible = await prisma.robot.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, serialNumber: true, status: true, lastSeen: true },
  });
  console.log(`[ops] ${user.email} now sees ${visible.length} robot(s):`);
  visible.forEach((r) =>
    console.log(`       - ${r.serialNumber} | ${r.name} | ${r.status} | lastSeen=${r.lastSeen ?? 'never'}`),
  );
}

main()
  .catch((err) => {
    console.error('[ops] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
