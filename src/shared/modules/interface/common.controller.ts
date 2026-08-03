import { Controller, Get, Param, Query, Req, UseGuards, Delete, BadRequestException } from '@nestjs/common';
import { CommonService } from '../application/common.service';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../guards/jwt.guard';
import { IsAdminGuard } from '../../guards/isAdmin.guard';
import { Request } from 'express';
import { AccountType } from '../../../modules/account/domain/enums/account-type.enum';

@Controller('api/v1/customers')
export class CommonController {
  constructor(private customerService: CommonService) {}

  @Get('dropdown')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, IsAdminGuard)
  async getAllForDropdown(@Req() req: Request) {
    return  await this.customerService.getAllCustomersForDropdown(req.adminId);
  }

  @Get('banks/dropdown')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, IsAdminGuard)
  async getAllBanksForDropdown(@Req() req: Request) {
    return await this.customerService.getAllBankForDropdown(req.adminId);
  }

  @Get('userAndbanksdropdown')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, IsAdminGuard)
  async getAllbanksansUsersForDropdown(@Req() req: Request) {
    return  await this.customerService.getAllCustomersandBanksForDropdown(req.adminId);
  }

  @Get('currency/account/:cId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, IsAdminGuard)
  async CurrencyAccounts(@Req() req: Request, @Param('cId') cid: string) {
    return await this.customerService.getAllCurrencyAccountsForDropdown(req.adminId, cid);
  }
  
  @Get('currency/dropdown')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, IsAdminGuard)
  async getCurrencyofUser(@Req() req: Request) {
    return await this.customerService.getCurrencyofUser(req.adminId);
  }

  @Get('chq-ref/dropdown')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, IsAdminGuard)
  async getRefBanks(@Req() req: Request) {
    return await this.customerService.getRefBanks(req.adminId);
  }

  @Get('general/:accountType/dropdown')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, IsAdminGuard)
  async getGeneralAccountsByType(
    @Req() req: Request,
    @Param('accountType') accountType: string,
  ) {
    if (!Object.values(AccountType).includes(accountType as AccountType)) {
      throw new BadRequestException('Invalid account type provided.');
    }
    return await this.customerService.getGeneralAccountsByType(
      req.adminId,
      accountType as AccountType,
    );
  }

  @Get('accounts/all-dropdown')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, IsAdminGuard)
  async getAllAccountsForDropdown(
    @Req() req: Request,
  ) {
    if (!req.adminId) {
      throw new BadRequestException(
        'Admin ID is required. Please ensure you are properly authenticated.',
      );
    }
    return await this.customerService.getAllAccountsForDropdown(
      req.adminId,
    );
  }

  @Delete('cache/clear-accounts')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, IsAdminGuard)
  async clearAccountsCache(@Req() req: Request) {
    if (!req.adminId) {
      throw new BadRequestException(
        'Admin ID is required. Please ensure you are properly authenticated.',
      );
    }
    await this.customerService.clearAccountsCache(req.adminId);
    return {
      success: true,
      message: 'Account cache cleared successfully',
    };
  }

  @Get('get-module-by-id')
  async getModuleById(
    @Query('module') module: string,
    @Query('id') id: string,
  ) {
    return this.customerService.getModuleById(module, id);
  }
}
