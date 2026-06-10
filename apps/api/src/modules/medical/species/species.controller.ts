import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { SpeciesService } from './species.service';

@Controller('species')
@UseGuards(JwtAuthGuard)
export class SpeciesController {
  constructor(private readonly speciesService: SpeciesService) {}

  @Get()
  findAll() {
    return this.speciesService.findAll();
  }

  @Get(':id/breeds')
  findBreeds(@Param('id', ParseUUIDPipe) id: string) {
    return this.speciesService.findBreedsBySpecies(id);
  }
}
