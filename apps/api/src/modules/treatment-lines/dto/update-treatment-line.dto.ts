import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateTreatmentLineDto } from './create-treatment-line.dto';

/** consultationId and prescribedBy cannot change after creation */
export class UpdateTreatmentLineDto extends PartialType(
  OmitType(CreateTreatmentLineDto, ['consultationId', 'prescribedBy'] as const),
) {}
