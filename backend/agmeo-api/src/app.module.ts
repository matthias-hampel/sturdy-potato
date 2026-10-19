import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard, OrgGuard } from './auth/auth.guards.js';
import { TokenService } from './auth/token.service.js';
import { ApiExceptionFilter } from './core/errors.js';
import { DatabaseModule } from './db/database.js';
import { CarbonController } from './modules/carbon/carbon.controller.js';
import { CarbonService } from './modules/carbon/carbon.service.js';
import { ComplianceController } from './modules/compliance/compliance.controller.js';
import { ComplianceService } from './modules/compliance/compliance.service.js';
import { CropsController } from './modules/crops/crops.controller.js';
import { CropsService } from './modules/crops/crops.service.js';
import { CropTableController } from './modules/crops/crop-table.controller.js';
import { CropTableService } from './modules/crops/crop-table.service.js';
import { DashboardController } from './modules/dashboard/dashboard.controller.js';
import { DashboardService } from './modules/dashboard/dashboard.service.js';
import { EconomicsController } from './modules/economics/economics.controller.js';
import { EconomicsService } from './modules/economics/economics.service.js';
import { EconomicsInsightsController } from './modules/economics/insights.controller.js';
import { ProfitabilityService } from './modules/economics/profitability.service.js';
import { FarmsController } from './modules/farms/farms.controller.js';
import { FilesController } from './modules/files/files.controller.js';
import { FilesService } from './modules/files/files.service.js';
import { ObjectStorage } from './storage/object-storage.js';
import { FarmsService } from './modules/farms/farms.service.js';
import { FieldGroupsController, FieldPartsController, FieldsController } from './modules/fields/fields.controller.js';
import { FieldGroupsService } from './modules/fields/field-groups.service.js';
import { FieldManagementService } from './modules/fields/field-management.service.js';
import { FieldPartsService } from './modules/fields/field-parts.service.js';
import { FieldsService } from './modules/fields/fields.service.js';
import { IdentityController } from './modules/identity/identity.controller.js';
import { IdentityService } from './modules/identity/identity.service.js';
import { InventoryController } from './modules/inventory/inventory.controller.js';
import { InventoryService } from './modules/inventory/inventory.service.js';
import { KtblController } from './modules/ktbl/ktbl.controller.js';
import { KtblService } from './modules/ktbl/ktbl.service.js';
import { MonitoringController } from './modules/monitoring/monitoring.controller.js';
import { MonitoringService } from './modules/monitoring/monitoring.service.js';
import { ProductivityController } from './modules/productivity/productivity.controller.js';
import { ProductivityService } from './modules/productivity/productivity.service.js';
import { PlanningController } from './modules/planning/planning.controller.js';
import { PlanningService } from './modules/planning/planning.service.js';
import { ProtectionController } from './modules/protection/protection.controller.js';
import { ProtectionService } from './modules/protection/protection.service.js';
import { PsmRecordController } from './modules/protection/record/psm-record.controller.js';
import { RadarController } from './modules/radar/radar.controller.js';
import { RadarService } from './modules/radar/radar.service.js';
import { PsmRecordService } from './modules/protection/record/psm-record.service.js';
import { NutrientsController } from './modules/nutrients/nutrients.controller.js';
import { NutrientsService } from './modules/nutrients/nutrients.service.js';
import { NitrogenController } from './modules/nutrients/nitrogen.controller.js';
import { NitrogenService } from './modules/nutrients/nitrogen.service.js';
import { BaseFertilizationController } from './modules/nutrients/base-fertilization.controller.js';
import { BaseFertilizationService } from './modules/nutrients/base-fertilization.service.js';
import { ExplainerService } from './modules/recommendations/explainer.service.js';
import { RecommendationsController } from './modules/recommendations/recommendations.controller.js';
import { RecommendationsService } from './modules/recommendations/recommendations.service.js';
import { RegulatoryController } from './modules/regulatory/regulatory.controller.js';
import { RegulatoryService } from './modules/regulatory/regulatory.service.js';
import { GeocodingController } from './modules/geocoding/geocoding.controller.js';
import { GeocodingService } from './modules/geocoding/geocoding.service.js';
import { SearchController } from './modules/search/search.controller.js';
import { SearchService } from './modules/search/search.service.js';
import { OperationsController } from './modules/operations/operations.controller.js';
import { BoardController } from './modules/operations/board.controller.js';
import { BoardService } from './modules/operations/board.service.js';
import { CommentsController } from './modules/comments/comments.controller.js';
import { CommentsService } from './modules/comments/comments.service.js';
import { OperationsService } from './modules/operations/operations.service.js';
import { SoilController } from './modules/soil/soil.controller.js';
import { SoilExportService } from './modules/soil/export.service.js';
import { SoilHistoryService } from './modules/soil/history.service.js';
import { SoilLabService } from './modules/soil/lab.service.js';
import { SoilSharePublicController } from './modules/soil/share.controller.js';
import { SoilShareService } from './modules/soil/share.service.js';
import { SoilZonationService } from './modules/soil/zonation.service.js';
import { VraController } from './modules/vra/vra.controller.js';
import { VraBasesController } from './modules/vra/vra-bases.controller.js';
import { VraOrgController } from './modules/vra/vra-org.controller.js';
import { VraBasesService } from './modules/vra/bases.service.js';
import { VraService } from './modules/vra/vra.service.js';
import { TasksController } from './modules/tasks/tasks.controller.js';
import { TasksService } from './modules/tasks/tasks.service.js';
import { TeamController } from './modules/team/team.controller.js';
import { TeamService } from './modules/team/team.service.js';
import { WeatherController } from './modules/weather/weather.controller.js';
import { CropModelsController } from './modules/weather/crop-models.controller.js';
import { WeatherService } from './modules/weather/weather.service.js';
import { FieldConditionsService } from './modules/weather/field-conditions.service.js';
import { CropModelsService } from './modules/weather/crop-models.service.js';
import { MaizeDmcClient } from './modules/maize-dmc/client.js';
import { MaizeDmcController } from './modules/maize-dmc/maize-dmc.controller.js';
import { MaizeDmcService } from './modules/maize-dmc/maize-dmc.service.js';
import { NewsController } from './modules/news/news.controller.js';
import { ModelServicesController } from './modules/model-services/model-services.controller.js';
import { ModelServicesService } from './modules/model-services/model-services.service.js';
import { NewsService } from './modules/news/news.service.js';
import { FieldDocumentsController } from './modules/documents/field-documents.controller.js';
import { FieldDocumentsService } from './modules/documents/field-documents.service.js';
import { AnnotationsController } from './modules/annotations/annotations.controller.js';
import { AnnotationsService } from './modules/annotations/annotations.service.js';
import { YieldController } from './modules/yield/yield.controller.js';
import { YieldService } from './modules/yield/yield.service.js';

export const DOMAIN_SERVICES = [
  IdentityService,
  FarmsService,
  FieldsService,
  FieldPartsService,
  FieldManagementService,
  FieldGroupsService,
  CropsService,
  CropTableService,
  InventoryService,
  TeamService,
  KtblService,
  OperationsService,
  TasksService,
  PlanningService,
  ProtectionService,
  PsmRecordService,
  NutrientsService,
  NitrogenService,
  BaseFertilizationService,
  RegulatoryService,
  EconomicsService,
  ProfitabilityService,
  ComplianceService,
  WeatherService,
  FieldConditionsService,
  CropModelsService,
  NewsService,
  MonitoringService,
  ProductivityService,
  VraService,
  VraBasesService,
  SoilZonationService,
  SoilExportService,
  SoilLabService,
  SoilHistoryService,
  SoilShareService,
  DashboardService,
  FilesService,
  BoardService,
  CommentsService,
  RadarService,
  CarbonService,
  YieldService,
  AnnotationsService,
  FieldDocumentsService,
  MaizeDmcService,
  ModelServicesService,
  ExplainerService,
  RecommendationsService,
  SearchService,
  GeocodingService,
];

/**
 * Modular monolith (ADR-001): one deployable with internal module boundaries per domain.
 * Guards run in order: authenticate, then resolve organization membership and permission.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [
    IdentityController,
    FarmsController,
    FieldsController,
    FieldPartsController,
    FieldGroupsController,
    CropsController,
    InventoryController,
    TeamController,
    KtblController,
    OperationsController,
    TasksController,
    PlanningController,
    ProtectionController,
    PsmRecordController,
    NutrientsController,
    NitrogenController,
    BaseFertilizationController,
    RegulatoryController,
    EconomicsController,
    EconomicsInsightsController,
    NewsController,
    ComplianceController,
    WeatherController,
    CropModelsController,
    CropTableController,
    MonitoringController,
    ProductivityController,
    VraController,
    VraBasesController,
    VraOrgController,
    SoilController,
    SoilSharePublicController,
    DashboardController,
    FilesController,
    BoardController,
    CommentsController,
    RadarController,
    CarbonController,
    YieldController,
    AnnotationsController,
    FieldDocumentsController,
    MaizeDmcController,
    ModelServicesController,
    RecommendationsController,
    SearchController,
    GeocodingController,
  ],
  providers: [
    TokenService,
    ObjectStorage,
    MaizeDmcClient,
    ...DOMAIN_SERVICES,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OrgGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
