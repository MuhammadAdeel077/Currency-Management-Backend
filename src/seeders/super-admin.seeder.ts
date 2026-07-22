import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { v4 as uuidV4 } from 'uuid';
import AppDataSource from '../../data-source';
import { UserEntity } from '../modules/users/domain/entities/user.entity';
import { UserTypeEntity } from '../modules/users/domain/entities/user-type.entity';

export class SuperAdminSeeder {
  public async run(dataSource: DataSource): Promise<void> {
    const userRepository = dataSource.getRepository(UserEntity);
    const userTypeRepository = dataSource.getRepository(UserTypeEntity);

    // Check if super admin already exists
    const existingSuperAdmin = await userRepository.findOne({
      where: { email: 'superadmin@dirham.com' },
    });

    if (existingSuperAdmin) {
      console.log('Super Admin already exists. Skipping seeder.');
      return;
    }

    // Ensure the superAdmin user type exists
    let superAdminType = await userTypeRepository.findOne({
      where: { name: 'superAdmin' },
    });
    if (!superAdminType) {
      superAdminType = await userTypeRepository.save(
        userTypeRepository.create({ id: uuidV4(), name: 'superAdmin' }),
      );
    }

    // Create default super admin directly in the users table
    const hashedPassword = await bcrypt.hash('SuperAdmin@123', 10);

    const superAdmin = userRepository.create({
      id: uuidV4(),
      email: 'superadmin@dirham.com',
      password: hashedPassword,
      name: 'Super Administrator',
      phone: '+923001234567',
      user_type_id: superAdminType.id,
      type: 'superAdmin',
      is_active: true,
      email_is_verified: true,
    });

    await userRepository.save(superAdmin);

    console.log('✅ Super Admin seeded successfully!');
    console.log('📧 Email: superadmin@dirham.com');
    console.log('🔑 Password: SuperAdmin@123');
    console.log('⚠️  Please change the password after first login!');
  }
}

// Run seeder if executed directly
if (require.main === module) {
  AppDataSource.initialize()
    .then(async (dataSource) => {
      const seeder = new SuperAdminSeeder();
      await seeder.run(dataSource);
      await dataSource.destroy();
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error seeding super admin:', error);
      process.exit(1);
    });
}
