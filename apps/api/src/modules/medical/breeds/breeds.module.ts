/**
 * Breeds are exposed under /species/:id/breeds (SpeciesModule).
 * This module re-exports SpeciesService for use in other modules that need
 * breed lookups (e.g. AppointmentsModule for pet registration).
 */
import { Module } from '@nestjs/common';
import { SpeciesModule } from '../species/species.module';

@Module({
  imports: [SpeciesModule],
  exports: [SpeciesModule],
})
export class BreedsModule {}
