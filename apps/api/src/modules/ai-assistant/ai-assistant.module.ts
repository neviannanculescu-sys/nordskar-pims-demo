import { Module } from '@nestjs/common';
import { AiAssistantService }    from './ai-assistant.service';
import { AiAssistantController } from './ai-assistant.controller';
import { ReportsModule }         from '../reports/reports.module';

@Module({
  imports:     [ReportsModule],
  controllers: [AiAssistantController],
  providers:   [AiAssistantService],
  exports:     [AiAssistantService],
})
export class AiAssistantModule {}
