import {
  Controller, Get, Post, Param, Body, Query, Req,
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
import { InvoicesService }      from './invoices.service';
import { CreateInvoiceDraftDto } from './dto/create-invoice.dto';
import { CreatePaymentDto }      from './dto/create-payment.dto';
import { CancelInvoiceDto }      from './dto/cancel-invoice.dto';

// Roluri care pot emite și gestiona facturi
const BILLING_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT] as const;

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @Roles(...MEDICAL_ROLES, UserRole.ACCOUNTANT)
  findAll(
    @Query('ownerId')        ownerId?: string,
    @Query('status')         status?: string,
    @Query('consultationId') consultationId?: string,
    @Query('page')           page?: string,
    @Query('limit')          limit?: string,
  ) {
    return this.invoicesService.findAll({
      ownerId, status, consultationId,
      page:  page  ? parseInt(page,  10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @Roles(...MEDICAL_ROLES, UserRole.ACCOUNTANT)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.findOneOrFail(id);
  }

  @Post()
  @Roles(...BILLING_ROLES)
  @HttpCode(HttpStatus.CREATED)
  createDraft(
    @Body() dto: CreateInvoiceDraftDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined };
    return this.invoicesService.createDraft(dto, ctx);
  }

  @Post(':id/issue')
  @Roles(...BILLING_ROLES)
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined };
    return this.invoicesService.issue(id, ctx);
  }

  @Post(':id/cancel')
  @Roles(...BILLING_ROLES)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelInvoiceDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined };
    return this.invoicesService.cancel(id, dto.reason, ctx);
  }

  @Post(':id/storno')
  @Roles(...BILLING_ROLES)
  storno(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined };
    return this.invoicesService.storno(id, ctx);
  }

  @Post(':id/payments')
  @Roles(...BILLING_ROLES)
  @HttpCode(HttpStatus.CREATED)
  addPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined };
    return this.invoicesService.addPayment(id, dto, ctx);
  }
}
