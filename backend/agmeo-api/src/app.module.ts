import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuthGuard, OrgGuard } from './auth/auth.guards.js';
import { TokenService } from './auth/token.service.js';
import { ApiExceptionFilter } from './core/errors.js';
import { DatabaseModule } from './db/database.js';
import { ComplianceController } from './modules/compliance/compliance.controller.js';
import { ComplianceService } from './modules/compliance/compliance.service.js';
import { CropsController } from './modules/crops/crops.controller.js';
import { CropsService } from './modules/crops/crops.service.js';
import { DashboardController } from './modules/dashboard/dashboard.controller.js';
import { DashboardService } from './modules/dashboard/dashboard.service.js';
import { EconomicsController } from './modules/economics/economics.controller.js';
import { EconomicsService } from './modules/economics/economics.service.js';
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
import { MonitoringController } from './modules/monitoring/monitoring.controller.js';
import { MonitoringService } from './modules/monitoring/monitoring.service.js';
import { ProductivityController } from './modules/productivity/productivity.controller.js';
import { ProductivityService } from './modules/productivity/productivity.service.js';
import { PlanningController } from './modules/planning/planning.controller.js';
import { PlanningService } from './modules/planning/planning.service.js';
import { ProtectionController } from './modules/protection/protection.controller.js';
import { ProtectionService } from './modules/protection/protection.service.js';
import { PsmRecordController } from './modules/protection/record/psm-record.controller.js';
import { PsmRecordService } from './modules/protection/record/psm-record.service.js';
import { NutrientsController } from './modules/nutrients/nutrients.controller.js';
import { NutrientsService } from './modules/nutrients/nutrients.service.js';
import { RegulatoryController } from './modules/regulatory/regulatory.controller.js';
import { RegulatoryService } from './modules/regulatory/regulatory.service.js';
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
import { VraService } from './modules/vra/vra.service.js';
import { TasksController } from './modules/tasks/tasks.controller.js';
import { TasksService } from './modules/tasks/tasks.service.js';
import { TeamController } from './modules/team/team.controller.js';
import { TeamService } from './modules/team/team.service.js';
import { WeatherController } from './modules/weather/weather.controller.js';
import { WeatherService } from './modules/weather/weather.service.js';

export const DOMAIN_SERVICES = [
  IdentityService,
  FarmsService,
  FieldsService,
  FieldPartsService,
  FieldManagementService,
  FieldGroupsService,
  CropsService,
  InventoryService,
  TeamService,
  OperationsService,
  TasksService,
  PlanningService,
  ProtectionService,
  PsmRecordService,
  NutrientsService,
  RegulatoryService,
  EconomicsService,
  ComplianceService,
  WeatherService,
  MonitoringService,
  ProductivityService,
  VraService,
  SoilZonationService,
  SoilExportService,
  SoilLabService,
  SoilHistoryService,
  SoilShareService,
  DashboardService,
  FilesService,
  BoardService,
  CommentsService,
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
    OperationsController,
    TasksController,
    PlanningController,
    ProtectionController,
    PsmRecordController,
    NutrientsController,
    RegulatoryController,
    EconomicsController,
    ComplianceController,
    WeatherController,
    MonitoringController,
    ProductivityController,
    VraController,
    SoilController,
    SoilSharePublicController,
    DashboardController,
    FilesController,
    BoardController,
    CommentsController,
  ],
  providers: [
    TokenService,
    ObjectStorage,
    ...DOMAIN_SERVICES,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: OrgGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
