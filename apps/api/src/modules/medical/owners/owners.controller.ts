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
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard }   from '../../../common/guards/roles.guard';
import { Roles }        from '../../../common/decorators/roles.decorator';
import { CurrentUser }  from '../../../common/decorators/current-user.decorator';
import { UserRole, MEDICAL_ROLES } from '../../../common/constants/roles.constants';
import { RequestUser }  from '../../../common/types/jwt.types';
import { OwnersService } from './owners.service';
import { CreateOwnerDto } from './dto/create-owner.dto';
import { UpdateOwnerDto } from './dto/update-owner.dto';
import { QueryOwnersDto } from './dto/query-owners.dto';
import { Request } from 'express';

@Controller('owners')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OwnersController {
  constructor(private readonly ownersService: OwnersService) {}

  // ACCOUNTANT and IT_ADMIN excluded: owners contain GDPR-protected PII.
  @Get()
  @Roles(...MEDICAL_ROLES)
  findAll(@Query() query: QueryOwnersDto) {
    return this.ownersService.findAll(query);
  }

  @Get(':id')
  @Roles(...MEDICAL_ROLES)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.ownersService.findOneOrFail(id);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.ASSISTANT)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateOwnerDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.ownersService.create(dto, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST, UserRole.ASSISTANT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOwnerDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.ownersService.update(id, dto, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.ownersService.softDelete(id, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }
}
