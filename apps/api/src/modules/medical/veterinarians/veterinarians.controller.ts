import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { VeterinariansService } from './veterinarians.service';

@Controller('veterinarians')
@UseGuards(JwtAuthGuard)
export class VeterinariansController {
  constructor(private readonly veterinariansService: VeterinariansService) {}

  @Get()
  findAll() {
    return this.veterinariansService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.veterinariansService.findOneOrFail(id);
  }
}
