import { Module } from '@nestjs/common';
import { ReportsController }        from './reports.controller';
import { ReportsService }           from './reports.service';
import { AccountingExportService }  from './accounting-export.service';
import { KpiService }               from './kpi.service';

@Module({
  controllers: [ReportsController],
  providers:   [ReportsService, AccountingExportService, KpiService],
  exports:     [ReportsService, AccountingExportService, KpiService],
})
export class ReportsModule {}
