import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();

async function main() {
  console.log('Bắt đầu tạo tài khoản admin...');
  const passwordHash = await bcrypt.hash('123456', 12);

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: passwordHash,
      fullname: 'Quản trị viên (Khôi phục)',
      role: 'TECH',
      active: true,
    },
  });

  console.log('Đã khôi phục tài khoản admin thành công!');
  console.log('====================================');
  console.log('Tên đăng nhập : admin');
  console.log('Mật khẩu      : 123456');
  console.log('Vai trò       : Kỹ thuật viên (Toàn quyền)');
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
