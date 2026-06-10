import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard }   from '../../common/guards/roles.guard';
import { Roles }        from '../../common/decorators/roles.decorator';
import { CurrentUser }  from '../../common/decorators/current-user.decorator';
import { UserRole, MEDICAL_ROLES } from '../../common/constants/roles.constants';
import { RequestUser }  from '../../common/types/jwt.types';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import {
  CancelAppointmentDto,
  QueryAppointmentsDto,
  QueryCalendarDto,
} from './dto/query-appointments.dto';

@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  // ---------------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------------

  @Get()
  @Roles(...MEDICAL_ROLES)
  findAll(@Query() query: QueryAppointmentsDto) {
    return this.appointmentsService.findAll(query);
  }

  /** Must be declared before :id to avoid shadowing */
  @Get('calendar')
  @Roles(...MEDICAL_ROLES)
  getCalendar(@Query() query: QueryCalendarDto) {
    return this.appointmentsService.getCalendar(query);
  }

  @Get(':id')
  @Roles(...MEDICAL_ROLES)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.appointmentsService.findOneOrFail(id);
  }

  // ---------------------------------------------------------------------------
  // Create / Update
  // ---------------------------------------------------------------------------

  @Post()
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.VET_DOCTOR, UserRole.ASSISTANT)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.appointmentsService.create(dto, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
      role:      user.role as UserRole,
    });
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.appointmentsService.update(id, dto, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------------

  @Post(':id/confirm')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  @HttpCode(HttpStatus.OK)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.appointmentsService.confirm(id, user.role as UserRole, {
      userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  @Post(':id/check-in')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.ASSISTANT)
  @HttpCode(HttpStatus.OK)
  checkIn(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.appointmentsService.checkIn(id, user.role as UserRole, {
      userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  @Post(':id/start')
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT)
  @HttpCode(HttpStatus.OK)
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.appointmentsService.start(id, user.role as UserRole, {
      userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  @Post(':id/complete')
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR)
  @HttpCode(HttpStatus.OK)
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.appointmentsService.complete(id, user.role as UserRole, {
      userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  @Post(':id/cancel')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.VET_DOCTOR)
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.appointmentsService.cancel(id, dto, user.role as UserRole, {
      userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  @Post(':id/no-show')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  @HttpCode(HttpStatus.OK)
  noShow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.appointmentsService.noShow(id, user.role as UserRole, {
      userId: user.id, ip: req.ip, sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }
}
