import { UserTypeEntity } from '../modules/users/domain/entities/user-type.entity';
import AppDataSource from '../../data-source';

const seedUserTypes = async () => {
  const dataSource = AppDataSource;

  try {
    await dataSource.initialize();

    const userTypeRepo = dataSource.getRepository(UserTypeEntity);

    const userTypes = [
      { name: 'superAdmin' },
      { name: 'admin' },
      { name: 'customer' },
    ];

    for (const type of userTypes) {
      const exists = await userTypeRepo.findOne({ where: { name: type.name } });
      if (!exists) {
        await userTypeRepo.save(userTypeRepo.create(type));
      }
    }

    console.log(' User types seeding completed.');
  } catch (error) {
    console.error(' Error seeding user types:', error);
  } finally {
    await dataSource.destroy();
  }
};

seedUserTypes();
