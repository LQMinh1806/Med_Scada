import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();

async function main() {
  console.log('Bắt đầu tạo và khôi phục tài khoản...');
  const defaultPasswordHash = await bcrypt.hash('123456', 12);

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {
      passwordHash: defaultPasswordHash,
      active: true,
      role: 'TECH',
    },
    create: {
      username: 'admin',
      passwordHash: defaultPasswordHash,
      fullname: 'Quản trị viên (Khôi phục)',
      role: 'TECH',
      active: true,
    },
  });

  const stationUsers = [
    { username: 'user01', fullname: 'Nhân viên Cấp Cứu (ST-01)', stationId: 'ST-01' },
    { username: 'user02', fullname: 'Nhân viên Khám Bệnh (ST-02)', stationId: 'ST-02' },
    { username: 'user03', fullname: 'Nhân viên Hồi Sức (ST-03)', stationId: 'ST-03' },
    { username: 'user04', fullname: 'Nhân viên Xét Nghiệm (ST-04)', stationId: 'ST-04' },
  ];

  for (const u of stationUsers) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: {
        passwordHash: defaultPasswordHash,
        active: true,
        role: 'OPERATOR',
        stationId: u.stationId,
      },
      create: {
        username: u.username,
        passwordHash: defaultPasswordHash,
        fullname: u.fullname,
        role: 'OPERATOR',
        stationId: u.stationId,
        active: true,
      },
    });
  }

  console.log('Đã khôi phục tài khoản thành công!');
  console.log('====================================');
  console.log('Tài khoản Admin : admin / 123456 (Toàn quyền)');
  console.log('Tài khoản Trạm  : user01 .. user04 / 123456');
  console.log('====================================');
}

main()
  .catch((e) => {
    console.error('Lỗi khi tạo tài khoản:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
