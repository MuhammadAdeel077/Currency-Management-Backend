import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { v4 as uuidV4 } from 'uuid';
import { AdminPaymentEntity } from '../domain/entities/admin-payment.entity';
import { UserEntity } from '../../users/domain/entities/user.entity';
import { UserTypeEntity } from '../../users/domain/entities/user-type.entity';
import { SuperAdminLoginDto } from '../domain/dto/super-admin-login.dto';
import { CreateAdminDto } from '../domain/dto/create-admin.dto';
import { UpdateAdminDto } from '../domain/dto/update-admin.dto';
import { CreatePaymentDto } from '../domain/dto/create-payment.dto';
import { UpdatePaymentDto } from '../domain/dto/update-payment.dto';
import { FilterAdminsDto } from '../domain/dto/filter-admins.dto';
import { FilterUsersDto } from '../domain/dto/filter-users.dto';
import { FilterAllPaymentsDto } from '../domain/dto/filter-all-payments.dto';
import { BlockUserDto } from '../domain/dto/block-user.dto';
import { DashboardStatsDto } from '../domain/dto/dashboard-stats.dto';
import { PaymentStatus } from '../domain/entities/admin-payment.entity';

@Injectable()
export class SuperAdminService {
  constructor(
    @InjectRepository(AdminPaymentEntity)
    private adminPaymentRepository: Repository<AdminPaymentEntity>,
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    @InjectRepository(UserTypeEntity)
    private userTypeRepository: Repository<UserTypeEntity>,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  // Get (or create) a user_type id by name.
  private async getUserTypeId(name: string): Promise<string> {
    let userType = await this.userTypeRepository.findOne({ where: { name } });
    if (!userType) {
      userType = await this.userTypeRepository.save(
        this.userTypeRepository.create({ id: uuidV4(), name }),
      );
    }
    return userType.id;
  }

  // Seed Default Super Admin (runs on startup)
  async seedDefaultSuperAdmin(): Promise<void> {
    try {
      const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'superadmin@dirham.com';
      const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin@123';
      const superAdminName = process.env.SUPER_ADMIN_NAME || 'Super Administrator';
      const superAdminPhone = process.env.SUPER_ADMIN_PHONE || '+923001234567';

      // Check if super admin already exists
      const existingSuperAdmin = await this.userRepository.findOne({
        where: { email: superAdminEmail },
      });

      if (existingSuperAdmin) {
        console.log('✅ Super Admin already exists. Skipping seed.');
        return;
      }

      const superAdminTypeId = await this.getUserTypeId('superAdmin');

      // Create default super admin
      const hashedPassword = await bcrypt.hash(superAdminPassword, 10);

      const superAdmin = this.userRepository.create({
        id: uuidV4(),
        email: superAdminEmail,
        password: hashedPassword,
        name: superAdminName,
        phone: superAdminPhone,
        user_type_id: superAdminTypeId,
        type: 'superAdmin',
        is_active: true,
        email_is_verified: true,
      });

      await this.userRepository.save(superAdmin);

      console.log('✅ Super Admin seeded successfully!');
      console.log('📧 Email:', superAdminEmail);
      console.log('⚠️  Please change the password after first login!');
    } catch (error) {
      console.error('❌ Error seeding super admin:', error.message);
    }
  }

  // Super Admin Login
  async login(loginDto: SuperAdminLoginDto) {
    const { email, password } = loginDto;

    const superAdminTypeId = await this.getUserTypeId('superAdmin');

    const superAdmin = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });

    if (!superAdmin || superAdmin.user_type_id !== superAdminTypeId) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!superAdmin.is_active) {
      throw new UnauthorizedException('Your account has been deactivated');
    }

    const isPasswordValid = await bcrypt.compare(password, superAdmin.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      id: superAdmin.id,
      email: superAdmin.email,
      role: 'super-admin',
    };

    const token = this.jwtService.sign(payload);

    return {
      message: 'Login successful',
      access_token: token,
      super_admin: {
        id: superAdmin.id,
        email: superAdmin.email,
        name: superAdmin.name,
        phone: superAdmin.phone,
      },
    };
  }
// Create Admin
  async createAdmin(createAdminDto: CreateAdminDto) {
    const { email, password, name, phone, type } = createAdminDto;

    // Check if user with email already exists
    const existingUser = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // Use transaction to ensure all operations succeed or all fail
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Get or create "admin" user type
      let adminUserType = await queryRunner.manager.findOne(UserTypeEntity, {
        where: { name: 'admin' },
      });

      if (!adminUserType) {
        adminUserType = queryRunner.manager.create(UserTypeEntity, {
          id: uuidV4(),
          name: 'admin',
        });
        adminUserType = await queryRunner.manager.save(adminUserType);
      }

      // Create user — role and sub-type now live directly on the users table.
      const user = queryRunner.manager.create(UserEntity, {
        id: uuidV4(),
        email: email.toLowerCase(),
        password: hashedPassword,
        name,
        phone,
        email_is_verified: true,
        block_status: false,
        user_type_id: adminUserType.id,
        type: type || 'admin',
      });

      const savedUser = await queryRunner.manager.save(user);

      // Commit transaction
      await queryRunner.commitTransaction();

      return {
        message: 'Admin created successfully',
        admin: {
          id: savedUser.id,
          email: savedUser.email,
          name: savedUser.name,
          phone: savedUser.phone,
          type,
        },
      };
    } catch (error) {
      // Rollback transaction on error
      await queryRunner.rollbackTransaction();
      
      // Re-throw the error with a user-friendly message
      if (error.code === '23505') {
        // Unique constraint violation
        throw new ConflictException('Admin with this email already exists');
      }
      
      throw new BadRequestException(
        `Failed to create admin: ${error.message}`,
      );
    } finally {
      // Release query runner
      await queryRunner.release();
    }
  }

  // Get All Admins with Filtering and Pagination
  async getAllAdmins(filterDto: FilterAdminsDto) {
    const { search, type, block_status, page = 1, limit = 10 } = filterDto;

    const adminTypeId = await this.getUserTypeId('admin');

    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .where('user.user_type_id = :adminTypeId', { adminTypeId });

    if (search) {
      queryBuilder.andWhere(
        '(user.name ILIKE :search OR user.email ILIKE :search OR user.phone ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (type) {
      queryBuilder.andWhere('user.type = :type', { type });
    }

    if (block_status !== undefined) {
      queryBuilder.andWhere('user.block_status = :block_status', {
        block_status,
      });
    }

    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [users, total] = await queryBuilder.getManyAndCount();

    const adminsWithDetails = await Promise.all(
      users.map(async (user) => {
        const payments = await this.adminPaymentRepository.find({
          where: { admin_id: user.id },
          order: { createdAt: 'DESC' },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          password: user.password,
          block_status: user.block_status,
          type: user.type,
          payments: payments.map((p) => ({
            id: p.id,
            transaction_id: p.transaction_id,
            amount: p.amount,
            status: p.status,
            due_date: p.due_date,
            paid_date: p.paid_date,
            description: p.description,
          })),
          createdAt: user.createdAt,
        };
      }),
    );

    return {
      data: adminsWithDetails,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Get Single Admin Details
  async getAdminById(adminId: string) {
    const user = await this.userRepository.findOne({
      where: { id: adminId },
    });

    if (!user) {
      throw new NotFoundException('Admin not found');
    }

    // Get payment info
    const payments = await this.adminPaymentRepository.find({
      where: { admin_id: user.id },
      order: { createdAt: 'DESC' },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      password: user.password,
      block_status: user.block_status,
      type: user.type,
      account_balance: user.account_balance,
      balance_in: user.balance_in,
      email_is_verified: user.email_is_verified,
      last_login: user.last_login,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      payments: payments.map((p) => ({
        id: p.id,
        transaction_id: p.transaction_id,
        amount: p.amount,
        status: p.status,
        due_date: p.due_date,
        paid_date: p.paid_date,
        description: p.description,
        createdAt: p.createdAt,
      })),
    };
  }

  // Update Admin
  async updateAdmin(adminId: string, updateDto: UpdateAdminDto) {
    const user = await this.userRepository.findOne({
      where: { id: adminId },
    });

    if (!user) {
      throw new NotFoundException('Admin not found');
    }

    // Update user details
    if (updateDto.name) user.name = updateDto.name;
    if (updateDto.phone) user.phone = updateDto.phone;
    if (updateDto.block_status !== undefined)
      user.block_status = updateDto.block_status;
    
    // Update password if provided
    if (updateDto.password) {
      const hashedPassword = await bcrypt.hash(updateDto.password, 10);
      user.password = hashedPassword;
    }

    // Update admin sub-type if provided (now stored on the user row).
    if (updateDto.type) {
      user.type = updateDto.type;
    }

    await this.userRepository.save(user);

    return {
      message: 'Admin updated successfully',
      admin: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        block_status: user.block_status,
      },
    };
  }

  // Delete Admin
  async deleteAdmin(adminId: string) {
    const user = await this.userRepository.findOne({
      where: { id: adminId },
    });

    if (!user) {
      throw new NotFoundException('Admin not found');
    }

    // Delete this admin's payments first, then the user row itself.
    await this.adminPaymentRepository.delete({ admin_id: adminId });
    await this.userRepository.delete(user.id);

    return {
      message: 'Admin deleted successfully',
    };
  }

  // Create Payment for Admin
  async createPayment(createPaymentDto: CreatePaymentDto) {
    const { admin_id, amount, status, description, due_date } =
      createPaymentDto;

    // Verify admin exists
    const admin = await this.userRepository.findOne({
      where: { id: admin_id },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    // Generate unique transaction ID
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();
    const transaction_id = `TXN-${timestamp}-${randomPart}`;

    const payment = this.adminPaymentRepository.create({
      id: uuidV4(),
      transaction_id,
      admin_id,
      amount,
      status,
      description,
      due_date: due_date ? new Date(due_date) : null,
    });

    const savedPayment = await this.adminPaymentRepository.save(payment);

    return {
      message: 'Payment created successfully',
      payment: {
        id: savedPayment.id,
        transaction_id: savedPayment.transaction_id,
        admin_id: savedPayment.admin_id,
        admin_name: admin.name,
        amount: savedPayment.amount,
        status: savedPayment.status,
        description: savedPayment.description,
        due_date: savedPayment.due_date
      },
    };
  }

  // Update Payment Status
  async updatePayment(paymentId: string, updateDto: UpdatePaymentDto) {
    const payment = await this.adminPaymentRepository.findOne({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (updateDto.amount !== undefined) payment.amount = updateDto.amount;
    if (updateDto.description) payment.description = updateDto.description;
    if (updateDto.due_date) payment.due_date = new Date(updateDto.due_date);
    
    // If status is being changed to 'paid' and paid_date is not provided, auto-fill it
    if (updateDto.status === PaymentStatus.PAID) {
      if (updateDto.paid_date) {
        payment.paid_date = new Date(updateDto.paid_date);
      } else {
        payment.paid_date = new Date(); // Auto-fill with current date/time
      }
      payment.status = updateDto.status;
    } else if (updateDto.status) {
      payment.status = updateDto.status;
      // If status is changed from paid to something else, clear paid_date
      payment.paid_date = null;
    }
    
    // If paid_date is explicitly provided for non-paid status, use it
    if (updateDto.paid_date && updateDto.status && updateDto.status !== PaymentStatus.PAID) {
      payment.paid_date = new Date(updateDto.paid_date);
    }

    const updatedPayment = await this.adminPaymentRepository.save(payment);

    // Get admin details
    const admin = await this.userRepository.findOne({
      where: { id: updatedPayment.admin_id },
    });

    return {
      message: 'Payment updated successfully',
      payment: {
        id: updatedPayment.id,
        transaction_id: updatedPayment.transaction_id,
        admin_id: updatedPayment.admin_id,
        admin_name: admin?.name || null,
        amount: updatedPayment.amount,
        status: updatedPayment.status,
        description: updatedPayment.description,
        due_date: updatedPayment.due_date,
        paid_date: updatedPayment.paid_date,
      },
    };
  }

  // Get All Payments for an Admin
  async getAdminPayments(adminId: string) {
    // Get admin details
    const admin = await this.userRepository.findOne({
      where: { id: adminId },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found');
    }

    const payments = await this.adminPaymentRepository.find({
      where: { admin_id: adminId },
      order: { createdAt: 'DESC' },
    });

    return {
      data: payments.map((p) => ({
        id: p.id,
        transaction_id: p.transaction_id,
        admin_id: p.admin_id,
        admin_name: admin.name,
        amount: p.amount,
        status: p.status,
        description: p.description,
        due_date: p.due_date,
        paid_date: p.paid_date,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    };
  }

  // Delete Payment
  async deletePayment(paymentId: string) {
    const payment = await this.adminPaymentRepository.findOne({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    await this.adminPaymentRepository.delete(paymentId);

    return {
      message: 'Payment deleted successfully',
    };
  }

  // Get All Payments with Filtering and Pagination
  async getAllPayments(filterDto: FilterAllPaymentsDto) {
    const { search, admin_name, status, page = 1, limit = 10 } = filterDto;

    const queryBuilder = this.adminPaymentRepository
      .createQueryBuilder('payment')
      .leftJoin('users', 'user', 'user.id = payment.admin_id');

    // Search by transaction_id
    if (search) {
      queryBuilder.andWhere('payment.transaction_id ILIKE :search', {
        search: `%${search}%`,
      });
    }

    // Filter by admin name
    if (admin_name) {
      queryBuilder.andWhere('user.name ILIKE :admin_name', {
        admin_name: `%${admin_name}%`,
      });
    }

    // Filter by payment status
    if (status) {
      queryBuilder.andWhere('payment.status = :status', { status });
    }

    // Pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    // Order by created date
    queryBuilder.orderBy('payment.createdAt', 'DESC');

    const [payments, total] = await queryBuilder.getManyAndCount();

    // Format the response with admin names
    const formattedPayments = await Promise.all(
      payments.map(async (payment) => {
        const admin = await this.userRepository.findOne({
          where: { id: payment.admin_id },
        });

        return {
          id: payment.id,
          transaction_id: payment.transaction_id,
          admin_id: payment.admin_id,
          admin_name: admin?.name || null,
          admin_email: admin?.email || null,
          amount: payment.amount,
          status: payment.status,
          description: payment.description,
          due_date: payment.due_date,
          paid_date: payment.paid_date,
          createdAt: payment.createdAt,
          updatedAt: payment.updatedAt,
        };
      }),
    );

    return {
      data: formattedPayments,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Get All Users with Filtering and Pagination
  async getAllUsers(filterDto: FilterUsersDto) {
    const { search, block_status, page = 1, limit = 10 } = filterDto;

    const adminTypeId = await this.getUserTypeId('admin');
    const superAdminTypeId = await this.getUserTypeId('superAdmin');

    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .where(
        '(user.user_type_id IS NULL OR user.user_type_id NOT IN (:...privilegedTypes))',
        { privilegedTypes: [adminTypeId, superAdminTypeId] },
      );

    // Apply search filter
    if (search) {
      queryBuilder.andWhere(
        '(user.name ILIKE :search OR user.email ILIKE :search OR user.phone ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Apply block status filter
    if (block_status !== undefined) {
      queryBuilder.andWhere('user.block_status = :block_status', {
        block_status,
      });
    }

    // Apply pagination
    const skip = (page - 1) * limit;
    queryBuilder.skip(skip).take(limit);

    const [users, total] = await queryBuilder.getManyAndCount();

    return {
      data: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        block_status: user.block_status,
        account_balance: user.account_balance,
        balance_in: user.balance_in,
        email_is_verified: user.email_is_verified,
        last_login: user.last_login,
        createdAt: user.createdAt,
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Get User Profile by ID
  async getUserProfile(userId: string) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      type: user.type,
      user_type_id: user.user_type_id,
      block_status: user.block_status,
      account_balance: user.account_balance,
      balance_in: user.balance_in,
      email_is_verified: user.email_is_verified,
      last_login: user.last_login,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  // Block/Unblock User
  async blockUser(userId: string, blockDto: BlockUserDto) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    user.block_status = blockDto.block_status;
    await this.userRepository.save(user);

    return {
      message: `User ${blockDto.block_status ? 'blocked' : 'unblocked'} successfully`,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        block_status: user.block_status,
      },
    };
  }

  // Block/Unblock Admin
  async blockAdmin(adminId: string, blockDto: BlockUserDto) {
    const user = await this.userRepository.findOne({
      where: { id: adminId },
    });

    if (!user) {
      throw new NotFoundException('Admin not found');
    }

    user.block_status = blockDto.block_status;
    await this.userRepository.save(user);

    return {
      message: `Admin ${blockDto.block_status ? 'blocked' : 'unblocked'} successfully`,
      admin: {
        id: user.id,
        email: user.email,
        name: user.name,
        block_status: user.block_status,
      },
    };
  }

  // ===================== DASHBOARD & ANALYTICS =====================

  // Get Dashboard Overview Stats
  async getDashboardStats() {
    const adminTypeId = await this.getUserTypeId('admin');

    // Total admins count
    const totalAdmins = await this.userRepository
      .createQueryBuilder('user')
      .where('user.user_type_id = :adminTypeId', { adminTypeId })
      .getCount();

    // Active admins (not blocked)
    const activeAdmins = await this.userRepository
      .createQueryBuilder('user')
      .where('user.user_type_id = :adminTypeId', { adminTypeId })
      .andWhere('user.block_status = :status', { status: false })
      .getCount();

    // Blocked admins
    const blockedAdmins = totalAdmins - activeAdmins;

    // Payment statistics
    const totalPayments = await this.adminPaymentRepository.count();

    const pendingPayments = await this.adminPaymentRepository.count({
      where: { status: PaymentStatus.PENDING },
    });

    const paidPayments = await this.adminPaymentRepository.count({
      where: { status: PaymentStatus.PAID },
    });

    const overduePayments = await this.adminPaymentRepository.count({
      where: { status: PaymentStatus.OVERDUE },
    });

    // Total revenue (paid payments)
    const paidPaymentsData = await this.adminPaymentRepository.find({
      where: { status: PaymentStatus.PAID },
    });

    const totalRevenue = paidPaymentsData.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );

    // Pending revenue
    const pendingPaymentsData = await this.adminPaymentRepository.find({
      where: { status: PaymentStatus.PENDING },
    });

    const pendingRevenue = pendingPaymentsData.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );

    // Overdue revenue
    const overduePaymentsData = await this.adminPaymentRepository.find({
      where: { status: PaymentStatus.OVERDUE },
    });

    const overdueRevenue = overduePaymentsData.reduce(
      (sum, payment) => sum + Number(payment.amount),
      0,
    );

    // Current month stats
    const currentDate = new Date();
    const firstDayOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth(),
      1,
    );
    const lastDayOfMonth = new Date(
      currentDate.getFullYear(),
      currentDate.getMonth() + 1,
      0,
    );

    const currentMonthPayments = await this.adminPaymentRepository
      .createQueryBuilder('payment')
      .where('payment.created_at >= :start', { start: firstDayOfMonth })
      .andWhere('payment.created_at <= :end', { end: lastDayOfMonth })
      .getMany();

    const currentMonthRevenue = currentMonthPayments
      .filter((p) => p.status === PaymentStatus.PAID)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);

    const currentMonthPending = currentMonthPayments.filter(
      (p) => p.status === PaymentStatus.PENDING,
    ).length;

    return {
      admins: {
        total: totalAdmins,
        active: activeAdmins,
        blocked: blockedAdmins,
      },
      payments: {
        total: totalPayments,
        pending: pendingPayments,
        paid: paidPayments,
        overdue: overduePayments,
      },
      revenue: {
        total: Number(totalRevenue.toFixed(2)),
        pending: Number(pendingRevenue.toFixed(2)),
        overdue: Number(overdueRevenue.toFixed(2)),
      },
      currentMonth: {
        revenue: Number(currentMonthRevenue.toFixed(2)),
        pendingPayments: currentMonthPending,
        totalPayments: currentMonthPayments.length,
      },
    };
  }

  // Get Monthly Payment Stats
  async getMonthlyStats(statsDto: DashboardStatsDto) {
    const { year, month } = statsDto;
    const currentYear = year || new Date().getFullYear().toString();
    const targetMonth = month ? parseInt(month.split('-')[1]) : null;

    let monthlyData = [];

    if (targetMonth) {
      // Get specific month data
      const monthDate = new Date(parseInt(currentYear), targetMonth - 1, 1);
      const firstDay = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth(),
        1,
      );
      const lastDay = new Date(
        monthDate.getFullYear(),
        monthDate.getMonth() + 1,
        0,
      );

      const payments = await this.adminPaymentRepository
        .createQueryBuilder('payment')
        .where('payment.created_at >= :start', { start: firstDay })
        .andWhere('payment.created_at <= :end', { end: lastDay })
        .getMany();

      const paid = payments.filter((p) => p.status === PaymentStatus.PAID);
      const pending = payments.filter((p) => p.status === PaymentStatus.PENDING);
      const overdue = payments.filter((p) => p.status === PaymentStatus.OVERDUE);

      monthlyData.push({
        month: `${currentYear}-${targetMonth.toString().padStart(2, '0')}`,
        totalPayments: payments.length,
        paidPayments: paid.length,
        pendingPayments: pending.length,
        overduePayments: overdue.length,
        totalRevenue: Number(
          paid.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
        ),
        pendingRevenue: Number(
          pending.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
        ),
        overdueRevenue: Number(
          overdue.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
        ),
      });
    } else {
      // Get all 12 months data for the year
      for (let m = 0; m < 12; m++) {
        const firstDay = new Date(parseInt(currentYear), m, 1);
        const lastDay = new Date(parseInt(currentYear), m + 1, 0);

        const payments = await this.adminPaymentRepository
          .createQueryBuilder('payment')
          .where('payment.created_at >= :start', { start: firstDay })
          .andWhere('payment.created_at <= :end', { end: lastDay })
          .getMany();

        const paid = payments.filter((p) => p.status === PaymentStatus.PAID);
        const pending = payments.filter(
          (p) => p.status === PaymentStatus.PENDING,
        );
        const overdue = payments.filter(
          (p) => p.status === PaymentStatus.OVERDUE,
        );

        monthlyData.push({
          month: `${currentYear}-${(m + 1).toString().padStart(2, '0')}`,
          totalPayments: payments.length,
          paidPayments: paid.length,
          pendingPayments: pending.length,
          overduePayments: overdue.length,
          totalRevenue: Number(
            paid.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
          ),
          pendingRevenue: Number(
            pending.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
          ),
          overdueRevenue: Number(
            overdue.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
          ),
        });
      }
    }

    return {
      year: currentYear,
      data: monthlyData,
    };
  }

  // Get Payment Cards/Summary by Status
  async getPaymentCards() {
    const now = new Date();

    // Pending Payments
    const pendingPayments = await this.adminPaymentRepository.find({
      where: { status: PaymentStatus.PENDING },
      order: { due_date: 'ASC' },
    });

    const pendingTotal = pendingPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    // Paid Payments (This Month)
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const paidThisMonth = await this.adminPaymentRepository
      .createQueryBuilder('payment')
      .where('payment.status = :status', { status: PaymentStatus.PAID })
      .andWhere('payment.paid_date >= :start', { start: firstDayOfMonth })
      .getMany();

    const paidTotal = paidThisMonth.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    // Overdue Payments
    const overduePayments = await this.adminPaymentRepository.find({
      where: { status: PaymentStatus.OVERDUE },
      order: { due_date: 'ASC' },
    });

    const overdueTotal = overduePayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    // Upcoming Due (Next 7 days)
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);

    const upcomingPayments = await this.adminPaymentRepository
      .createQueryBuilder('payment')
      .where('payment.status = :status', { status: PaymentStatus.PENDING })
      .andWhere('payment.due_date >= :now', { now })
      .andWhere('payment.due_date <= :nextWeek', { nextWeek })
      .orderBy('payment.due_date', 'ASC')
      .getMany();

    const upcomingTotal = upcomingPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    return {
      pending: {
        count: pendingPayments.length,
        total: Number(pendingTotal.toFixed(2)),
        payments: pendingPayments.slice(0, 5).map((p) => ({
          id: p.id,
          admin_id: p.admin_id,
          amount: p.amount,
          due_date: p.due_date,
          description: p.description,
        })),
      },
      paid: {
        count: paidThisMonth.length,
        total: Number(paidTotal.toFixed(2)),
        month: `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`,
      },
      overdue: {
        count: overduePayments.length,
        total: Number(overdueTotal.toFixed(2)),
        payments: overduePayments.slice(0, 5).map((p) => ({
          id: p.id,
          admin_id: p.admin_id,
          amount: p.amount,
          due_date: p.due_date,
          description: p.description,
        })),
      },
      upcoming: {
        count: upcomingPayments.length,
        total: Number(upcomingTotal.toFixed(2)),
        payments: upcomingPayments.map((p) => ({
          id: p.id,
          admin_id: p.admin_id,
          amount: p.amount,
          due_date: p.due_date,
          description: p.description,
        })),
      },
    };
  }

  // Get Admin-wise Payment Breakdown
  async getAdminPaymentBreakdown(statsDto: DashboardStatsDto) {
    const { page = 1, limit = 10 } = statsDto;

    const adminTypeId = await this.getUserTypeId('admin');

    // Get all admins directly from the users table.
    const adminsQuery = this.userRepository
      .createQueryBuilder('user')
      .where('user.user_type_id = :adminTypeId', { adminTypeId })
      .skip((page - 1) * limit)
      .take(limit);

    const [admins, total] = await adminsQuery.getManyAndCount();

    const adminBreakdown = await Promise.all(
      admins.map(async (admin) => {
        const payments = await this.adminPaymentRepository.find({
          where: { admin_id: admin.id },
        });

        const paid = payments.filter((p) => p.status === PaymentStatus.PAID);
        const pending = payments.filter(
          (p) => p.status === PaymentStatus.PENDING,
        );
        const overdue = payments.filter(
          (p) => p.status === PaymentStatus.OVERDUE,
        );

        return {
          admin_id: admin.id,
          admin_name: admin.name,
          admin_email: admin.email,
          total_payments: payments.length,
          paid_count: paid.length,
          pending_count: pending.length,
          overdue_count: overdue.length,
          total_paid: Number(
            paid.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
          ),
          total_pending: Number(
            pending.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
          ),
          total_overdue: Number(
            overdue.reduce((sum, p) => sum + Number(p.amount), 0).toFixed(2),
          ),
          last_payment_date:
            paid.length > 0
              ? paid.sort(
                  (a, b) =>
                    new Date(b.paid_date).getTime() -
                    new Date(a.paid_date).getTime(),
                )[0].paid_date
              : null,
        };
      }),
    );

    return {
      data: adminBreakdown,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
