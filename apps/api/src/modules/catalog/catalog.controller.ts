import {
  Controller, Get, Post, Patch, Param, Body, Query,
  ParseUUIDPipe, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard }  from '../auth/guards/jwt-auth.guard';
import { RolesGuard }    from '../auth/guards/roles.guard';
import { Roles }         from '../auth/decorators/roles.decorator';
import { CurrentUser }   from '../auth/decorators/current-user.decorator';
import { UserRole }      from '../../database/schema';
import { MEDICAL_ROLES } from '../../common/constants/roles.constants';
import { AuditContext }  from '../../common/helpers/audit.helper';
import { CatalogService } from './catalog.service';
import { CreatePriceCatalogDto }      from './dto/create-price-catalog.dto';
import { CreateProcedureTemplateDto } from './dto/create-procedure-template.dto';
import { PartialType } from '@nestjs/mapped-types';

class UpdatePriceCatalogDto extends PartialType(CreatePriceCatalogDto) {}
class UpdateProcedureTemplateDto extends PartialType(CreateProcedureTemplateDto) {}

@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // ---------------------------------------------------------------------------
  // Service categories (read-only for all medical staff)
  // ---------------------------------------------------------------------------

  @Get('categories')
  @Roles(...MEDICAL_ROLES)
  getCategories() {
    return this.catalogService.findAllCategories();
  }

  // ---------------------------------------------------------------------------
  // Price catalog
  // ---------------------------------------------------------------------------

  @Get('prices')
  @Roles(...MEDICAL_ROLES)
  getPrices(
    @Query('search') search?: string,
    @Query('serviceType') serviceType?: string,
    @Query('categoryId') categoryId?: string,
    @Query('isActive') isActive?: string,
    @Query('validOn') validOn?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.catalogService.findAllPrices({
      search,
      serviceType,
      categoryId,
      isActive:  isActive  !== undefined ? isActive  === 'true' : undefined,
      validOn,
      page:  page  ? parseInt(page,  10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('prices/:id')
  @Roles(...MEDICAL_ROLES)
  getPrice(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.findPriceOrFail(id);
  }

  @Post('prices')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createPrice(
    @Body() dto: CreatePriceCatalogDto,
    @CurrentUser() user: AuditContext,
  ) {
    return this.catalogService.createPrice(dto, user);
  }

  @Patch('prices/:id')
  @Roles(UserRole.ADMIN)
  updatePrice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriceCatalogDto,
    @CurrentUser() user: AuditContext,
  ) {
    return this.catalogService.updatePrice(id, dto, user);
  }

  // ---------------------------------------------------------------------------
  // Procedure templates
  // ---------------------------------------------------------------------------

  @Get('templates')
  @Roles(...MEDICAL_ROLES)
  getTemplates(
    @Query('isActive') isActive?: string,
    @Query('serviceId') serviceId?: string,
  ) {
    return this.catalogService.findAllTemplates({
      isActive:  isActive !== undefined ? isActive === 'true' : undefined,
      serviceId,
    });
  }

  @Get('templates/:id')
  @Roles(...MEDICAL_ROLES)
  getTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.findTemplateOrFail(id);
  }

  @Post('templates')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  createTemplate(
    @Body() dto: CreateProcedureTemplateDto,
    @CurrentUser() user: AuditContext,
  ) {
    return this.catalogService.createTemplate(dto, user);
  }

  @Patch('templates/:id')
  @Roles(UserRole.ADMIN)
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProcedureTemplateDto,
    @CurrentUser() user: AuditContext,
  ) {
    return this.catalogService.updateTemplate(id, dto, user);
  }
}
