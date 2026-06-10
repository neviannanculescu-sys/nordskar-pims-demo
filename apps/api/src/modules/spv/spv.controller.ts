import {
  Controller, Get, Post, Param, ParseUUIDPipe,
  UseGuards, HttpCode, HttpStatus, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard }  from '../auth/guards/jwt-auth.guard';
import { RolesGuard }    from '../auth/guards/roles.guard';
import { Roles }         from '../auth/decorators/roles.decorator';
import { CurrentUser }   from '../auth/decorators/current-user.decorator';
import { UserRole }      from '../../database/schema';
import { AuditContext }  from '../../common/helpers/audit.helper';
import { RequestUser }   from '../../common/types/jwt.types';
import { SpvService }    from './spv.service';

// Doar ADMIN și ACCOUNTANT interacționează cu ANAF/SPV
const SPV_ROLES = [UserRole.ADMIN, UserRole.ACCOUNTANT] as const;

@Controller('spv')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SpvController {
  constructor(private readonly spvService: SpvService) {}

  // Generare XML preview — fără upload
  @Get('invoices/:invoiceId/xml')
  @Roles(...SPV_ROLES)
  async generateXml(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    const { xml, sha256 } = await this.spvService.generateXml(invoiceId);
    return { xml, sha256 };
  }

  // Validare XML local (structural + opțional XSD)
  @Post('invoices/:invoiceId/validate')
  @Roles(...SPV_ROLES)
  async validateXml(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    const { xml } = await this.spvService.generateXml(invoiceId);
    return this.spvService.validateXml(xml);
  }

  // Submit la ANAF — acțiune manuală explicită, nu automată
  @Post('invoices/:invoiceId/submit')
  @Roles(...SPV_ROLES)
  @HttpCode(HttpStatus.CREATED)
  submit(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip };
    return this.spvService.submit(invoiceId, ctx);
  }

  // Polling manual status ANAF pentru o submission
  @Post('submissions/:id/poll')
  @Roles(...SPV_ROLES)
  pollStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    const ctx: AuditContext = { userId: user.id, ip: req.ip };
    return this.spvService.pollStatus(id, ctx);
  }

  // Vizualizare submission + toate răspunsurile ANAF
  @Get('submissions/:id')
  @Roles(...SPV_ROLES)
  getSubmission(@Param('id', ParseUUIDPipe) id: string) {
    return this.spvService.getSubmissionWithResponses(id);
  }

  // Lista facturi neconfirmate > 5 zile (trigger manual lângă cron-ul zilnic)
  @Get('alerts/unconfirmed')
  @Roles(...SPV_ROLES)
  getUnconfirmedAlerts() {
    return this.spvService.alertUnconfirmedSubmissions();
  }
}
