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
import { ProceduresService }     from './procedures.service';
import { CreateProcedureDto }    from './dto/create-procedure.dto';
import { UpdateProcedureDto }    from './dto/update-procedure.dto';
import { QueryProceduresDto }    from './dto/query-procedures.dto';

@Controller('procedures')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProceduresController {
  constructor(private readonly proceduresService: ProceduresService) {}

  @Get()
  @Roles(...MEDICAL_ROLES)
  findAll(@Query() query: QueryProceduresDto) {
    return this.proceduresService.findAll(query);
  }

  @Get(':id')
  @Roles(...MEDICAL_ROLES)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.proceduresService.findOneOrFail(id);
  }

  /** VET_DOCTOR and ASSISTANT perform procedures; RECEPTIONIST cannot */
  @Post()
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateProcedureDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.proceduresService.create(dto, {
      userId: user.id, ip: req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  /** Only VET_DOCTOR and ADMIN can correct a procedure record */
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProcedureDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.proceduresService.update(id, dto, {
      userId: user.id, ip: req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  /** ADMIN only; blocked if consultation is completed */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.proceduresService.softDelete(id, {
      userId: user.id, ip: req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }
}
