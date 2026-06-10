import { Module } from '@nestjs/common';
import { TreatmentLinesController } from './treatment-lines.controller';
import { TreatmentLinesService }    from './treatment-lines.service';

@Module({
  controllers: [TreatmentLinesController],
  providers:   [TreatmentLinesService],
  exports:     [TreatmentLinesService],
})
export class TreatmentLinesModule {}
