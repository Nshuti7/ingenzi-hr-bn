const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create departments
  const departments = await Promise.all([
    prisma.department.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        name: 'IT Department',
        description: 'Information Technology',
        status: 'active'
      }
    }),
    prisma.department.upsert({
      where: { id: 2 },
      update: {},
      create: {
        id: 2,
        name: 'HR Department',
        description: 'Human Resources',
        status: 'active'
      }
    }),
    prisma.department.upsert({
      where: { id: 3 },
      update: {},
      create: {
        id: 3,
        name: 'Finance Department',
        description: 'Finance & Accounting',
        status: 'active'
      }
    }),
    prisma.department.upsert({
      where: { id: 4 },
      update: {},
      create: {
        id: 4,
        name: 'Marketing Department',
        description: 'Marketing & Sales',
        status: 'active'
      }
    }),
    prisma.department.upsert({
      where: { id: 5 },
      update: {},
      create: {
        id: 5,
        name: 'Operations Department',
        description: 'Operations',
        status: 'active'
      }
    })
  ]);

  console.log('Created departments');

  // Hash password
  const hashedPassword = await bcrypt.hash('testpassword', 10);

  // Create users and employees
  const employeeUser = await prisma.user.upsert({
    where: { email: 'employee@ingenzi.com' },
    update: {},
    create: {
      email: 'employee@ingenzi.com',
      password: hashedPassword,
      name: 'John Doe',
      role: 'employee',
      employeeId: 'EMP001',
      employee: {
        create: {
          employeeId: 'EMP001',
          firstName: 'John',
          lastName: 'Doe',
          email: 'employee@ingenzi.com',
          phone: '+1234567890',
          departmentId: 1,
          position: 'Software Developer',
          salary: 5000,
          hireDate: new Date('2023-01-15'),
          status: 'active',
          address: '123 Main St, City, Country'
        }
      }
    },
    include: { employee: true }
  });

  const hrUser = await prisma.user.upsert({
    where: { email: 'hr@ingenzi.com' },
    update: {},
    create: {
      email: 'hr@ingenzi.com',
      password: hashedPassword,
      name: 'Jane Smith',
      role: 'hr_manager',
      employeeId: 'HR001',
      employee: {
        create: {
          employeeId: 'HR001',
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'hr@ingenzi.com',
          phone: '+1234567891',
          departmentId: 2,
          position: 'HR Manager',
          salary: 6000,
          hireDate: new Date('2022-06-01'),
          status: 'active',
          address: '456 Oak Ave, City, Country'
        }
      }
    },
    include: { employee: true }
  });

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@ingenzi.com' },
    update: {},
    create: {
      email: 'admin@ingenzi.com',
      password: hashedPassword,
      name: 'Admin User',
      role: 'system_admin',
      employeeId: 'ADM001',
      employee: {
        create: {
          employeeId: 'ADM001',
          firstName: 'Admin',
          lastName: 'User',
          email: 'admin@ingenzi.com',
          phone: '+1234567892',
          departmentId: 1,
          position: 'System Administrator',
          salary: 7000,
          hireDate: new Date('2022-01-01'),
          status: 'active',
          address: '789 Admin St, City, Country'
        }
      }
    },
    include: { employee: true }
  });

  console.log('Created users and employees');

  // Create leave types
  const leaveTypes = await Promise.all([
    prisma.leaveType.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        name: 'Annual Leave',
        days: 20,
        description: 'Annual vacation leave'
      }
    }),
    prisma.leaveType.upsert({
      where: { id: 2 },
      update: {},
      create: {
        id: 2,
        name: 'Sick Leave',
        days: 10,
        description: 'Medical leave'
      }
    }),
    prisma.leaveType.upsert({
      where: { id: 3 },
      update: {},
      create: {
        id: 3,
        name: 'Personal Leave',
        days: 5,
        description: 'Personal time off'
      }
    }),
    prisma.leaveType.upsert({
      where: { id: 4 },
      update: {},
      create: {
        id: 4,
        name: 'Maternity Leave',
        days: 90,
        description: 'Maternity leave'
      }
    }),
    prisma.leaveType.upsert({
      where: { id: 5 },
      update: {},
      create: {
        id: 5,
        name: 'Paternity Leave',
        days: 14,
        description: 'Paternity leave'
      }
    }),
    prisma.leaveType.upsert({
      where: { id: 6 },
      update: {},
      create: {
        id: 6,
        name: 'Emergency Leave',
        days: 3,
        description: 'Emergency situations'
      }
    }),
    prisma.leaveType.upsert({
      where: { id: 7 },
      update: {},
      create: {
        id: 7,
        name: 'Study Leave',
        days: 10,
        description: 'Educational purposes'
      }
    })
  ]);

  console.log('Created leave types');
  console.log('Seeding completed!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

