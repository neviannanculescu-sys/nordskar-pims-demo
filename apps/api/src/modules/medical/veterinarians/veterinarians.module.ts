import { Module } from '@nestjs/common';
import { VeterinariansController } from './veterinarians.controller';
import { VeterinariansService }    from './veterinarians.service';

@Module({
  controllers: [VeterinariansController],
  providers:   [VeterinariansService],
  exports:     [VeterinariansService],
})
export class VeterinariansModule {}
