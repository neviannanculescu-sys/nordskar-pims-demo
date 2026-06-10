import { Module } from '@nestjs/common';
import { PetsController, PetsStandaloneController } from './pets.controller';
import { PetsService } from './pets.service';

@Module({
  controllers: [PetsController, PetsStandaloneController],
  providers:   [PetsService],
  exports:     [PetsService],
})
export class PetsModule {}
