import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() { if (process.env.SEED_USER_EMAIL) { await prisma.user.upsert({ where: { googleId: 'seed-user' }, update: {}, create: { googleId: 'seed-user', name: 'Local User', email: process.env.SEED_USER_EMAIL } }); } }
main().finally(() => prisma.$disconnect());
