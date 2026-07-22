import * as bcrypt from 'bcrypt';
import { v4 as uuidV4 } from 'uuid';
import AppDataSource from '../../data-source';

interface SeedAdmin {
  email: string;
  password: string;
  name: string;
}

const ADMINS: SeedAdmin[] = [
  { email: 'testadmin@gmail.com', password: 'Admin@123', name: 'Test Admin' },
  { email: 'admindirham@gmail.com', password: 'Admin@123', name: 'Admin Dirham' },
];

async function seedAdmins() {
  const ds = await AppDataSource.initialize();

  try {
    // 1. Ensure the "admin" user type exists and grab its id.
    let rows = await ds.query(`SELECT id FROM user_types WHERE name = 'admin'`);
    let adminTypeId: string;
    if (rows.length === 0) {
      adminTypeId = uuidV4();
      await ds.query(
        `INSERT INTO user_types (id, name, created_at, updated_at)
         VALUES ($1, 'admin', now(), now())`,
        [adminTypeId],
      );
      console.log(`🆕 Created 'admin' user type (${adminTypeId})`);
    } else {
      adminTypeId = rows[0].id;
      console.log(`✅ Found existing 'admin' user type (${adminTypeId})`);
    }

    // 2. Insert each admin (skip if the email already exists).
    for (const admin of ADMINS) {
      const email = admin.email.toLowerCase();
      const existing = await ds.query(
        `SELECT id FROM users WHERE email = $1`,
        [email],
      );

      if (existing.length > 0) {
        console.log(`⏭️  Admin already exists, skipping: ${email}`);
        continue;
      }

      const hashedPassword = await bcrypt.hash(admin.password, 10);
      const id = uuidV4();

      await ds.query(
        `INSERT INTO users
           (id, email, password, name, user_type_id, type,
            email_is_verified, block_status, is_active,
            account_balance, balance_in, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'admin', true, false, true, 0, 'PKR', now(), now())`,
        [id, email, hashedPassword, admin.name, adminTypeId],
      );

      console.log(`✅ Seeded admin: ${email} (${id})`);
    }

    console.log('🎉 Admin seeding completed.');
  } catch (error) {
    console.error('❌ Error seeding admins:', error.message);
    throw error;
  } finally {
    await ds.destroy();
  }
}

seedAdmins()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
