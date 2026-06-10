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
import { PetsService }  from './pets.service';
import { CreatePetDto } from './dto/create-pet.dto';
import { UpdatePetDto } from './dto/update-pet.dto';
import { QueryPetsDto } from './dto/query-pets.dto';
import { Request } from 'express';

@Controller('owners/:ownerId/pets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PetsController {
  constructor(private readonly petsService: PetsService) {}

  // ACCOUNTANT and IT_ADMIN excluded: pet records contain medical/GDPR data.
  @Get()
  @Roles(...MEDICAL_ROLES)
  findAll(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Query() query: QueryPetsDto,
  ) {
    return this.petsService.findByOwner(ownerId, query);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT, UserRole.RECEPTIONIST)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
    @Body() dto: CreatePetDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.petsService.create(ownerId, dto, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }
}

/**
 * Pet-level operations not scoped under an owner.
 */
@Controller('pets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PetsStandaloneController {
  constructor(private readonly petsService: PetsService) {}

  @Get(':id')
  @Roles(...MEDICAL_ROLES)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.petsService.findOneOrFail(id);
  }

  // Receptionist excluded: editing existing pet records (allergies, chip, medical
  // conditions) requires medical staff verification. Receptionist can CREATE pets
  // at check-in but corrections go through assistant or vet.
  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.VET_DOCTOR, UserRole.ASSISTANT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePetDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.petsService.update(id, dto, {
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
    return this.petsService.softDelete(id, {
      userId:    user.id,
      ip:        req.ip,
      sessionId: req.headers['x-session-id'] as string | undefined,
    });
  }
}
