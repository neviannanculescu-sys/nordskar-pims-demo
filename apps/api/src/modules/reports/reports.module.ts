import { Module } from '@nestjs/common';
import { ScheduleModule }           from '@nestjs/schedule';
import { ReportsController }        from './reports.controller';
import { ReportsService }           from './reports.service';
import { AccountingExportService }  from './accounting-export.service';
import { KpiService }               from './kpi.service';
import { ReconciliationService }    from './reconciliation.service';
import { AnomalyService }           from './anomaly.service';

@Module({
  imports:     [ScheduleModule.forRoot()],
  controllers: [ReportsController],
  providers:   [ReportsService, AccountingExportService, KpiService, ReconciliationService, AnomalyService],
  exports:     [ReportsService, AccountingExportService, KpiService, ReconciliationService, AnomalyService],
})
export class ReportsModule {}
