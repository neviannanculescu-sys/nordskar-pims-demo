export enum UserRole {
  ADMIN        = 'admin',
  VET_DOCTOR   = 'vet_doctor',
  ASSISTANT    = 'assistant',
  RECEPTIONIST = 'receptionist',
  ACCOUNTANT   = 'accountant',
  IT_ADMIN     = 'it_admin',
}

export const ROLES_KEY = 'roles';

/**
 * Roles with access to medical/patient data (owners, pets, consultations).
 * ACCOUNTANT and IT_ADMIN are intentionally excluded:
 * - ACCOUNTANT accesses financial aggregates only (no PII/GDPR medical records)
 * - IT_ADMIN accesses audit logs and system config only (no patient data)
 */
export const MEDICAL_ROLES = [
  UserRole.ADMIN,
  UserRole.VET_DOCTOR,
  UserRole.ASSISTANT,
  UserRole.RECEPTIONIST,
] as const;
