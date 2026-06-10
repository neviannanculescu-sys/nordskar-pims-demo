import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { DatabaseModule }        from './database/database.module';
import { AuthModule }            from './modules/auth/auth.module';
import { UsersModule }           from './modules/users/users.module';
import { HealthModule }          from './modules/health/health.module';
import { OwnersModule }          from './modules/medical/owners/owners.module';
import { PetsModule }            from './modules/medical/pets/pets.module';
import { SpeciesModule }         from './modules/medical/species/species.module';
import { VeterinariansModule }   from './modules/medical/veterinarians/veterinarians.module';
import { RoomsModule }           from './modules/medical/rooms/rooms.module';
import { AppointmentsModule }    from './modules/appointments/appointments.module';
import { ConsultationsModule }   from './modules/consultations/consultations.module';
import { ProceduresModule }      from './modules/procedures/procedures.module';
import { TreatmentLinesModule }  from './modules/treatment-lines/treatment-lines.module';
import { CatalogModule }         from './modules/catalog/catalog.module';
import { InventoryModule }       from './modules/inventory/inventory.module';
import { InvoicesModule }        from './modules/invoices/invoices.module';
import { SpvModule }             from './modules/spv/spv.module';
import { ReportsModule }         from './modules/reports/reports.module';
import { AiAssistantModule }    from './modules/ai-assistant/ai-assistant.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal:    true,
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level:     process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport: process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
        // Per CLAUDE.md §8: never log PII — redact sensitive fields
        redact: ['req.headers.authorization', 'req.body.password'],
        serializers: {
          req: (req: { method: string; url: string; id: string }) => ({
            method: req.method,
            url:    req.url,
            id:     req.id,
          }),
        },
      },
    }),
    DatabaseModule,
    AuthModule,
    UsersModule,
    HealthModule,
    OwnersModule,
    PetsModule,
    SpeciesModule,
    VeterinariansModule,
    RoomsModule,
    AppointmentsModule,
    ConsultationsModule,
    ProceduresModule,
    TreatmentLinesModule,
    CatalogModule,
    InventoryModule,
    InvoicesModule,
    SpvModule,
    ReportsModule,
    AiAssistantModule,
  ],
})
export class AppModule {}
