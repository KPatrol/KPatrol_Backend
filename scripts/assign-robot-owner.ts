/**
 * One-shot ops script: upsert a user and transfer ownership of a robot serial
 * to that user. Idempotent — re-running with the same env produces no diff.
 *
 * Run inside the backend container so DATABASE_URL is already wired:
 *   docker exec -i kpatrol-backend node -e "$(cat assign-robot-owner.js)"
 * or as TS:
 *   docker exec -i kpatrol-backend npx ts-node scripts/assign-robot-owner.ts
 *
 * Required env (override any of these via -e flags or inline):
 *   OWNER_EMAIL       (e.g. khoa.vu@kpatrol.online)
 *   OWNER_PASSWORD    (e.g. KPatrol@2026)
 *   OWNER_NAME        (e.g. "Khoa Vu")
 *   ROBOT_SERIAL      (default: KPATROL-001)
 *   MAKE_ADMIN        (default: "true")
 */

import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = required('OWNER_EMAIL');
  const password = required('OWNER_PASSWORD');
  const name = process.env.OWNER_NAME ?? email.split('@')[0];
  const robotSerial = process.env.ROBOT_SERIAL ?? 'KPATROL-001';
  const makeAdmin = (process.env.MAKE_ADMIN ?? 'true').toLowerCase() !== 'false';
  const role = makeAdmin ? Role.ADMIN : Role.USER;

  // 1. Upsert user. Re-hash password on every run so /settings password
  //    changes do NOT get clobbered when re-running this script.
  const existing = await prisma.user.findUnique({ where: { email } });
  const hashed = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      role,
      // Only overwrite password if the caller explicitly set FORCE_RESET_PASSWORD=true,
      // so we don't accidentally reset a user's own chosen password on every run.
      ...(process.env.FORCE_RESET_PASSWORD === 'true' ? { password: hashed } : {}),
    },
    create: { email, password: hashed, name, role },
  });
  console.log(`[ops] user ${existing ? 'updated' : 'created'}: ${user.email} (id=${user.id}, role=${user.role})`);

  // 2. Find the robot by serialNumber.
  const robot = await prisma.robot.findUnique({ where: { serialNumber: robotSerial } });
  if (!robot) {
    console.error(`[ops] robot ${robotSerial} NOT FOUND — run "npx prisma db seed" first, or check serial spelling`);
    process.exit(2);
  }

  if (robot.userId === user.id) {
    console.log(`[ops] robot ${robot.serialNumber} already owned by ${user.email} — nothing to do`);
  } else {
    const old = await prisma.user.findUnique({ where: { id: robot.userId } });
    await prisma.robot.update({ where: { id: robot.id }, data: { userId: user.id } });
    console.log(
      `[ops] robot ${robot.serialNumber} ownership transferred: ${old?.email ?? robot.userId} -> ${user.email}`,
    );
  }

  // 3. Diagnostic listing — confirm what user can see after login.
  const visible = await prisma.robot.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, serialNumber: true, status: true, lastSeen: true },
  });
  console.log(`[ops] ${user.email} now sees ${visible.length} robot(s):`);
  visible.forEach((r) =>
    console.log(`       - ${r.serialNumber} | ${r.name} | ${r.status} | lastSeen=${r.lastSeen ?? 'never'}`),
  );
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[ops] missing required env ${name}`);
    process.exit(1);
  }
  return v;
}

main()
  .catch((err) => {
    console.error('[ops] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
