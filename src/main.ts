import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GlobalSanitizerPipe } from './shared/pipes/global-sanitizer.pipe';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { LoggerService } from './modules/logger/logger.service';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import express from 'express';
import { SuperAdminService } from './modules/super-admin/application/super-admin.service';
import { types as pgTypes } from 'pg';

// node-postgres parses plain DATE columns (OID 1082) as local-midnight JS Date
// objects, so serializing them back to JSON shifts the calendar day by one
// whenever this process's TZ isn't UTC (e.g. journal/sale/purchase entries
// silently reporting the wrong date, or a future-dated entry appearing to
// belong to the previous day). Keep DATE columns as the raw "YYYY-MM-DD"
// string TypeORM/Postgres already gives us.
pgTypes.setTypeParser(pgTypes.builtins.DATE, (value: string) => value);

async function bootstrap() {
  const loggerService: LoggerService = new LoggerService();
  const app = await NestFactory.create(AppModule, {
    logger: loggerService.logger,
  });

  // Global exception filter for consistent error handling
  app.useGlobalFilters(new HttpExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({ 
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
    new GlobalSanitizerPipe(),
  );
  app.enableCors();

  const configService = app.get(ConfigService);

  const config = new DocumentBuilder()
    .setTitle('Admin Panel')
    .setDescription('API Documentation for Admin Panel')
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      name: 'Authorization',
      description: 'Enter JWT token',
      in: 'header',
    })
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  app.use('/api/v1/webhooks', express.raw({ type: 'application/json' }));
  app.use(express.urlencoded({ extended: false }));

  // Seed default super admin on startup
  const superAdminService = app.get(SuperAdminService);
  await superAdminService.seedDefaultSuperAdmin();

  await app.listen(configService.get('PORT'));
}

bootstrap();
