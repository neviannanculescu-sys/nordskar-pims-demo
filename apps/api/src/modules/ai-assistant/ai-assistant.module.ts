import { Module } from '@nestjs/common';
import { AiAssistantService }    from './ai-assistant.service';
import { AiAssistantController } from './ai-assistant.controller';

@Module({
  controllers: [AiAssistantController],
  providers:   [AiAssistantService],
  exports:     [AiAssistantService],
})
export class AiAssistantModule {}
