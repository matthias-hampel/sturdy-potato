import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { config } from './config.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: '20mb' });
  app.setGlobalPrefix('v1');
  app.enableCors({ origin: config.corsOrigin.split(','), credentials: false });
  app.enableShutdownHooks();
  await app.listen(config.port);
}
await bootstrap();
