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

  // În development acceptăm orice origine (live-server, file://, Cloudflare preview).
  // În production APP_URL poate fi o listă separată prin virgulă:
  //   APP_URL=https://nordskar-pims-demo.pages.dev,https://demo.nordskar.ro
  const isDev = (process.env.NODE_ENV ?? 'development') !== 'production';
  const rawAllowed = process.env.APP_URL ?? 'http://localhost:3000';
  const allowedOrigins = rawAllowed.split(',').map(o => o.trim()).filter(Boolean);

  app.enableCors({
    origin: isDev
      ? (origin: string | undefined, cb: (err: null, ok: boolean) => void) => cb(null, true)
      : (origin: string | undefined, cb: (err: Error | null, ok: boolean) => void) => {
          if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
          cb(new Error(`CORS: origin ${origin} not allowed`), false);
        },
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

bootstrap();
