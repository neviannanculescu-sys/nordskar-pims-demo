import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateProcedureDto } from './create-procedure.dto';

/** consultationId cannot be changed after creation */
export class UpdateProcedureDto extends PartialType(
  OmitType(CreateProcedureDto, ['consultationId'] as const),
) {}
