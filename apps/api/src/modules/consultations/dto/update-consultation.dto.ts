import { PartialType } from '@nestjs/mapped-types';
import { CreateConsultationDto } from './create-consultation.dto';

/**
 * All fields optional; appointmentId and core FKs (pet/owner/vet) are excluded
 * from updates — reassigning those requires a new consultation.
 * Only allowed while status = 'open'.
 */
export class UpdateConsultationDto extends PartialType(CreateConsultationDto) {}
