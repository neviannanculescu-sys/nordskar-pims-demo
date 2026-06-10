import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'admin',
  'vet_doctor',
  'assistant',
  'receptionist',
  'accountant',
  'it_admin',
]);

export const ownerTypeEnum = pgEnum('owner_type', ['individual', 'company']);

export const preferredChannelEnum = pgEnum('preferred_channel', [
  'phone',
  'email',
  'whatsapp',
  'sms',
]);

export const petGenderEnum = pgEnum('pet_gender', ['male', 'female', 'unknown']);

export const roomTypeEnum = pgEnum('room_type', [
  'consultation',
  'surgery',
  'hospitalization',
  'lab',
  'imaging',
  'other',
]);

export const appointmentTypeEnum = pgEnum('appointment_type', [
  'routine',
  'emergency',
  'followup',
  'surgery',
  'hospitalization',
  'vaccination',
  'other',
]);

export const appointmentStatusEnum = pgEnum('appointment_status', [
  'scheduled',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'no_show',
  'cancelled',
]);

export const appointmentSourceEnum = pgEnum('appointment_source', [
  'phone',
  'online',
  'walkin',
  'whatsapp',
  'internal',
]);

export const consultationTypeEnum = pgEnum('consultation_type', [
  'routine',
  'emergency',
  'followup',
  'second_opinion',
  'teleconsultation',
]);

export const consultationStatusEnum = pgEnum('consultation_status', [
  'open',
  'completed',
  'cancelled',
]);

export const consultationPrognosisEnum = pgEnum('consultation_prognosis', [
  'good',
  'guarded',
  'poor',
  'unknown',
]);

export const spvSubmissionStatusEnum = pgEnum('spv_submission_status', [
  'pending',      // XML generat, neîncărcat încă
  'uploading',    // request HTTP în curs
  'uploaded',     // ANAF a primit, index_incarcare disponibil
  'processing',   // "în prelucrare" conform polling ANAF
  'accepted',     // "ok" — ANAF a acceptat factura
  'rejected',     // "nok" — ANAF a respins cu erori
  'error',        // eroare tehnică (timeout, HTTP 5xx, XML invalid)
]);

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'cancelled',
  'storno',
]);

export const paymentMethodEnum = pgEnum('payment_method', [
  'cash',
  'card',
  'bank_transfer',
  'voucher',
  'other',
]);

// Valori uppercase: PostgreSQL TG_OP returnează 'INSERT'/'UPDATE'/'DELETE'
export const auditActionEnum = pgEnum('audit_action', [
  'INSERT',
  'UPDATE',
  'DELETE',
]);
