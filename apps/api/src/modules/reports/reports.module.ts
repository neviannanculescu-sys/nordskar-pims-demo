import { Module } from '@nestjs/common';
import { ReportsController }        from './reports.controller';
import { ReportsService }           from './reports.service';
import { AccountingExportService }  from './accounting-export.service';

@Module({
  controllers: [ReportsController],
  providers:   [ReportsService, AccountingExportService],
  exports:     [ReportsService, AccountingExportService],
})
export class ReportsModule {}
