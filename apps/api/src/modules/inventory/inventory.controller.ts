import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Req,
  ParseUUIDPipe, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard }  from '../auth/guards/jwt-auth.guard';
import { RolesGuard }    from '../auth/guards/roles.guard';
import { Roles }         from '../auth/decorators/roles.decorator';
import { CurrentUser }   from '../auth/decorators/current-user.decorator';
import { UserRole }      from '../../database/schema';
import { MEDICAL_ROLES } from '../../common/constants/roles.constants';
import { AuditContext }  from '../../common/helpers/audit.helper';
import { RequestUser }   from '../../common/types/jwt.types';
import { InventoryService }         from './inventory.service';
import { CreateInventoryItemDto }   from './dto/create-inventory-item.dto';
import { CreateStockMovementDto }   from './dto/create-stock-movement.dto';
import { PartialType } from '@nestjs/mapped-types';

class UpdateInventoryItemDto extends PartialType(CreateInventoryItemDto) {}

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  // ---------------------------------------------------------------------------
  // Inventory items
  // ---------------------------------------------------------------------------

  @Get('items')
  @Roles(...MEDICAL_ROLES)
  getItems(
    @Query('search')   search?: string,
    @Query('category') category?: string,
    @Query('isActive') isActive?: string,
    @Query('lowStock') lowStock?: string,
    @Query('page')     page?: string,
    @Query('limit')    limit?: string,
  ) {
    return this.inventoryService.findAllItems({
      search,
      category,
      isActive:  isActive  !== undefined ? isActive  === 'true' : undefined,
      lowStock:  lowStock  === 'true',
      page:  page  ? parseInt(page,  10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('items/:id')
  @Roles(...MEDICAL_ROLES)
  getItem(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventoryService.findItemOrFail(id);
  }

  @Post('items')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createItem(
    @Body() dto: CreateInventoryItemDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip };
    return this.inventoryService.createItem(dto, ctx);
  }

  @Patch('items/:id')
  @Roles(UserRole.ADMIN)
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInventoryItemDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip };
    return this.inventoryService.updateItem(id, dto as any, ctx);
  }

  @Delete('items/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteItem(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip };
    return this.inventoryService.softDeleteItem(id, ctx);
  }

  // ---------------------------------------------------------------------------
  // Stock movements
  // ---------------------------------------------------------------------------

  @Get('items/:id/movements')
  @Roles(...MEDICAL_ROLES)
  getMovements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.getMovementHistory(id, limit ? parseInt(limit, 10) : 50);
  }

  @Post('movements')
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT)
  @HttpCode(HttpStatus.CREATED)
  addMovement(
    @Body() dto: CreateStockMovementDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip };
    return this.inventoryService.addMovement(dto, ctx);
  }

  // ---------------------------------------------------------------------------
  // Billing candidates (billing prep — ADMIN + all medical roles)
  // ---------------------------------------------------------------------------

  @Get('billing-candidates')
  @Roles(...MEDICAL_ROLES)
  getBillingCandidates(
    @Query('consultationId') consultationId?: string,
    @Query('ownerId')        ownerId?: string,
    @Query('page')           page?: string,
    @Query('limit')          limit?: string,
  ) {
    return this.inventoryService.getBillingCandidates({
      consultationId,
      ownerId,
      page:  page  ? parseInt(page,  10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
