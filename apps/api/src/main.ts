import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:            true,
      forbidNonWhitelisted: true,
      transform:            true,
      transformOptions:     { enableImplicitConversion: false },
    }),
  );

  // În development acceptăm origini multiple (live-server, file://, Cloudflare preview).
  // În production APP_URL trebuie setat la domeniul exact.
  const isDev = (process.env.NODE_ENV ?? 'development') !== 'production';
  const allowedOrigin = process.env.APP_URL ?? 'http://localhost:3000';

  app.enableCors({
    origin: isDev
      ? (origin: string | undefined, cb: (err: null, ok: boolean) => void) => cb(null, true)
      : allowedOrigin,
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

bootstrap();
