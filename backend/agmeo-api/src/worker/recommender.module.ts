import { Module } from '@nestjs/common';
import { config } from '../config.js';
import { createKysely, Database, KYSELY } from '../db/database.js';
import { NutrientsService } from '../modules/nutrients/nutrients.service.js';
import { OperationsService } from '../modules/operations/operations.service.js';
import { ProtectionService } from '../modules/protection/protection.service.js';
import { ExplainerService } from '../modules/recommendations/explainer.service.js';
import { RecommendationsService } from '../modules/recommendations/recommendations.service.js';
import { TasksService } from '../modules/tasks/tasks.service.js';
import { WeatherService } from '../modules/weather/weather.service.js';

/**
 * The recommendation services for the worker, on the agmeo_recommender connection: it reads
 * what the rule set needs and writes recommendations, one organization at a time.
 */
@Module({
  providers: [
    { provide: KYSELY, useFactory: () => createKysely(config.recommenderDatabaseUrl, 4) },
    Database,
    WeatherService,
    NutrientsService,
    ProtectionService,
    OperationsService,
    TasksService,
    ExplainerService,
    RecommendationsService,
  ],
})
export class RecommenderModule {}
