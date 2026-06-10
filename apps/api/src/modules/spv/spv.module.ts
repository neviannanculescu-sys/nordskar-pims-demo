import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { SpvController }    from './spv.controller';
import { SpvService }       from './spv.service';
import { AnafApiClient }    from './anaf-api.client';
import { XsdValidator }     from './xml/xsd.validator';
import { AiAssistantModule } from '../ai-assistant/ai-assistant.module';

@Module({
  imports: [
    HttpModule.register({ timeout: 30_000, maxRedirects: 3 }),
    ScheduleModule.forRoot(),
    AiAssistantModule,
  ],
  controllers: [SpvController],
  providers:   [SpvService, AnafApiClient, XsdValidator],
  exports:     [SpvService],
})
export class SpvModule {}
