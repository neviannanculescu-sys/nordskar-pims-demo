import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard }   from '../../common/guards/roles.guard';
import { Roles }        from '../../common/decorators/roles.decorator';
import { CurrentUser }  from '../../common/decorators/current-user.decorator';
import { UserRole, MEDICAL_ROLES } from '../../common/constants/roles.constants';
import { RequestUser }  from '../../common/types/jwt.types';
import { ConsultationsService } from './consultations.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';
import { QueryConsultationsDto } from './dto/query-consultations.dto';

/**
 * Used only by ADMIN when completing a consultation on behalf of a vet.
 * VET_DOCTOR role derives signingVetId automatically from their user profile.
 */
class CompleteConsultationDto {
  @IsOptional()
  @IsUUID()
  signingVetId?: string;
}

@Controller('consultations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConsultationsController {
  constructor(private readonly consultationsService: ConsultationsService) {}

  // ---------------------------------------------------------------------------
  // Read — MEDICAL_ROLES only (no accountant / it_admin)
  // ---------------------------------------------------------------------------

  @Get()
  @Roles(...MEDICAL_ROLES)
  findAll(@Query() query: QueryConsultationsDto) {
    return this.consultationsService.findAll(query);
  }

  @Get(':id')
  @Roles(...MEDICAL_ROLES)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.consultationsService.findOneOrFail(id);
  }

  // ---------------------------------------------------------------------------
  // Create — VET_DOCTOR, ASSISTANT, ADMIN
  // RECEPTIONIST excluded: cannot open a medical record
  // ---------------------------------------------------------------------------

  @Post()
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateConsultationDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.consultationsService.create(dto, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Update — VET_DOCTOR, ASSISTANT, ADMIN; only while open
  // ---------------------------------------------------------------------------

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConsultationDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.consultationsService.update(id, dto, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Complete (sign + seal)
  //
  // VET_DOCTOR: signingVetId is derived automatically from user.id → veterinarian.userId
  // ADMIN: must supply signingVetId in request body
  // ---------------------------------------------------------------------------

  @Post(':id/complete')
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR)
  @HttpCode(HttpStatus.OK)
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteConsultationDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.consultationsService.complete(
      id,
      user.id,
      user.role as UserRole,
      { userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined },
      dto.signingVetId,
    );
  }

  // ---------------------------------------------------------------------------
  // Cancel — ADMIN and VET_DOCTOR; only open consultations
  // ---------------------------------------------------------------------------

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR)
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.consultationsService.cancel(id, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Soft delete — ADMIN only; completed consultations are permanently protected
  // ---------------------------------------------------------------------------

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.consultationsService.softDelete(id, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }
}
