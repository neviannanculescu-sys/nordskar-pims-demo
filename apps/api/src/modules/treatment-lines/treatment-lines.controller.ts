import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, UseGuards,
  HttpCode, HttpStatus, ParseUUIDPipe, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard }  from '../../common/guards/jwt-auth.guard';
import { RolesGuard }    from '../../common/guards/roles.guard';
import { Roles }         from '../../common/decorators/roles.decorator';
import { CurrentUser }   from '../../common/decorators/current-user.decorator';
import { UserRole, MEDICAL_ROLES } from '../../common/constants/roles.constants';
import { RequestUser }   from '../../common/types/jwt.types';
import { TreatmentLinesService }    from './treatment-lines.service';
import { CreateTreatmentLineDto }   from './dto/create-treatment-line.dto';
import { UpdateTreatmentLineDto }   from './dto/update-treatment-line.dto';
import { QueryTreatmentLinesDto }   from './dto/query-treatment-lines.dto';

@Controller('treatment-lines')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TreatmentLinesController {
  constructor(private readonly treatmentLinesService: TreatmentLinesService) {}

  @Get()
  @Roles(...MEDICAL_ROLES)
  findAll(@Query() query: QueryTreatmentLinesDto) {
    return this.treatmentLinesService.findAll(query);
  }

  @Get(':id')
  @Roles(...MEDICAL_ROLES)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.treatmentLinesService.findOneOrFail(id);
  }

  /** VET_DOCTOR prescribes; ASSISTANT can register administration */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateTreatmentLineDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.treatmentLinesService.create(dto, {
      userId: user.id, ip: req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  /** Editing locked after dispense */
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTreatmentLineDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.treatmentLinesService.update(id, dto, {
      userId: user.id, ip: req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  /**
   * Marks the medication as physically dispensed.
   * In Phase 2 this triggers a stock_movements record.
   */
  @Post(':id/dispense')
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT)
  @HttpCode(HttpStatus.OK)
  dispense(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.treatmentLinesService.dispense(id, {
      userId: user.id, ip: req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  /** ADMIN only; blocked if already dispensed */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.treatmentLinesService.softDelete(id, {
      userId: user.id, ip: req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }
}
