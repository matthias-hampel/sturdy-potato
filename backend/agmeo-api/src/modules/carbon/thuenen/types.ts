/**
 * Request and response schemas of the Thünen AgriGHG tool's RothC humus model
 * (https://agrighg-tool.thuenen.de/api), ported from AGVOLUTION/agmeo src/lib/co2nserve/thuenen/types.ts.
 */
import { z } from 'zod';

const MonthSchema = z.number().int().min(1).max(12);

const YearSchema = z.number().int().min(1991).max(2024);

// prettier-ignore
const CROP_IDS = ["50","51","54","56","57","112","113","114","115","116","118","119","120","121","122","125","131","132","142","143","144","156","157","171","172","181","182","183","186","187","210","211","212","220","221","222","230","240","250","292","311","312","315","316","320","330","341","392","393","411","413","414","421","422","423","424","425","426","427","429","430","431","432","433","459","480","492","510","511","512","513","514","515","516","517","518","519","520","563","567","572","573","574","575","576","583","590","591","592","593","594","595","599","602","603","604","613","614","615","616","617","618","619","620","622","623","624","625","627","628","629","630","631","633","634","635","636","637","638","639","640","641","642","643","644","645","646","647","648","649","651","652","653","654","655","656","657","658","659","660","661","662","663","664","665","666","667","668","669","670","671","672","673","674","675","676","677","678","679","680","681","682","683","684","685","686","701","702","703","704","705","706","707","708","709","710","721","722","723","724","725","726","727","728","729","730","731","732","733","734","735","736","737","738","739","740","741","742","743","744","745","746","747","748","749","750","751","752","753","754","755","756","757","758","759","760","761","762","763","764","765","766","767","768","769","770","771","772","773","774","775","776","777","778","779","780","781","782","783","784","785","786","787","788","789","790","791","792","793","794","795","796","797","798","799","802","803","804","805","806","822","825","826","827","829","833","834","838","839","840","841","842","850","851","852","853","854","856","857","858","859","860","861","862","863","864","865","910","911","912","914","924","956","972","973","983","994","995","996","999","1001","1002","1003","1004","1005","1006","1007","1008","1009","1010","999999"] as const;

const CropIdSchema = z.enum(CROP_IDS);
export type CropId = (typeof CROP_IDS)[number];

const WKT4326PointSchema = z
  .string()
  .regex(/^(SRID=4326;)?POINT\s*\(\s*-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s*\)$/i)
  .superRefine((val, ctx) => {
    const m = val.match(
      /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i,
    );
    if (!m) return;
    const lon = Number(m[1]);
    const lat = Number(m[2]);
    if (lon < -180 || lon > 180)
      ctx.addIssue({
        code: 'custom',
        message: 'Longitude must be between -180 and 180',
      });
    if (lat < -90 || lat > 90)
      ctx.addIssue({
        code: 'custom',
        message: 'Latitude must be between -90 and 90',
      });
  });

// Note: The Thünen API has gaps in the ID sequence - the following IDs do NOT exist in their system:
// 16, 17, 19, 20, 27, 29, 31, 34, 35, 36, 37, 40, 43, 44, 45, 46, 48, 50
// See https://agrighg-tool.thuenen.de/api/v1/humusbalancerothc/openapi.json for the full list
const OrganicFertilizerNameSchema = z.enum([
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '18',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '28',
  '30',
  '32',
  '33',
  '38',
  '39',
  '41',
  '42',
  '47',
  '49',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '58',
  '59',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '67',
  '68',
  '69',
]);
export type OrganicFertilizerName = z.infer<typeof OrganicFertilizerNameSchema>;

const MineralFertilizerSchema = z
  .object({
    name: z.string(),
    // seems the API does accept only integers here
    N_rate: z.number().int().nullable().optional(),
  })
  .strict();
export type MineralFertilizer = z.infer<typeof MineralFertilizerSchema>;

const OrganicFertilizerSchema = z
  .object({
    name: OrganicFertilizerNameSchema,
    fert_rate: z.number(),
    DM_content: z.number().min(0).max(100).nullable().optional(),
    N_content: z.number().nullable().optional(),
  })
  .strict();
export type OrganicFertilizer = z.infer<typeof OrganicFertilizerSchema>;

const FertilizerBlockSchema = z
  .object({
    mineral: z.array(MineralFertilizerSchema).optional(),
    organic: z.array(OrganicFertilizerSchema).optional(),
  })
  .strict();

const MainCropSchema = z
  .object({
    name: CropIdSchema,
    sowing_month: MonthSchema.nullable().optional(),
    harvest_month: MonthSchema.nullable().optional(),
    harvest_main: z.boolean(),
    harvest_residue_main: z.boolean(),
    harvest_yield: z.number(),
  })
  .strict();

const CoverCropSchema = z
  .object({
    name: CropIdSchema,
    sowing_month: MonthSchema.nullable().optional(),
    kill_month: MonthSchema.nullable().optional(),
  })
  .strict();

const UndersownCropSchema = z
  .object({
    name: CropIdSchema,
    sowing_month: MonthSchema.nullable().optional(),
    kill_month: MonthSchema.nullable().optional(),
  })
  .strict();

const SecondaryCropSchema = z
  .object({
    cover_crop: CoverCropSchema.nullable().optional(),
    undersown_crop: UndersownCropSchema.nullable().optional(),
    harvest_sec: z.boolean().nullable().optional(),
  })
  .strict();

const YearDataSchema = z
  .object({
    year: YearSchema,
    main_crop: MainCropSchema,
    fertilizer: FertilizerBlockSchema.optional(),
    secondary_crop: SecondaryCropSchema.nullable().optional(),
    tillage: z.number().int().nullable().optional(), // API expects integer (centimeters)
    irrigation: z.number().nullable().optional(),
  })
  .strict();
export type YearData = z.infer<typeof YearDataSchema>;

const SiteSchema = z
  .object({
    site_name: z.string().min(1),
    location: WKT4326PointSchema,
    bd_fb: z.number().min(0.5).max(2),
    clay_content: z.number().min(0).max(100),
    soc_content: z.number().min(0.1).max(10),
    CN: z.number().nullable().optional(),
    start_year_v: YearSchema.nullable().optional(),
    end_year_v: YearSchema.nullable().optional(),
    field_name: z.string().nullable().optional(),
    field_size: z.number().positive().nullable().optional(),
    hasOrganicFarming: z.boolean().nullable().optional(),
    sample_depth: z.number().int().nullable().optional(), // API expects integer (centimeters)
    sand_content: z.number().min(0).max(100).nullable().optional(),
    skel: z.number().min(0).max(100).nullable().optional(),
    waterlogging: z.boolean().nullable().optional(),
  })
  .strict();

// Note: API requires all CarbonModel fields, but we mark them optional here
// since we always use DEFAULT_CARBON_MODEL from utils.ts which provides all values
const CarbonModelSchema = z
  .object({
    id: z.number().int(),
    name: z.string().min(1),
    project_path: z.string(),
    git_url: z.string().url(),
    branch_name: z.string(),
    commit: z.string(),
    main_script: z.string(),
    description: z.string(),
    maintainer_email: z.string().email(),
  })
  .strict();

export const ThuenenRunRRequestSchema = z
  .object({
    id: z.string(), // API requires id
    name: z.string().min(1),
    is_active: z.boolean(),
    executed_by: z.string(),
    carbon_model: CarbonModelSchema,
    management: z.object({ years: z.array(YearDataSchema).min(1) }).strict(),
    site: SiteSchema,
  })
  .strict();
export type ThuenenRunRRequest = z.infer<typeof ThuenenRunRRequestSchema>;

const RothCResultItemSchema = z
  .object({
    Time_ISO_8601: z.string(),
    SOC_stock_Mg_C_ha_1: z.number(),
    SOC_content_percent_C_ha_1: z.number(),
  })
  .strict();
export type RothCResultItem = z.infer<typeof RothCResultItemSchema>;

const RothCMetadataSchema = z
  .object({
    timestamp: z.string(),
    execution_time_seconds: z.number(),
  })
  .strict();

export const ThuenenRunRResponseSchema = z
  .object({
    data: z.array(RothCResultItemSchema),
    metadata: RothCMetadataSchema,
  })
  .strict();
export type ThuenenRunRResponse = z.infer<typeof ThuenenRunRResponseSchema>;

export const ThuenenRunRResponseBatchSchema = z.object({
  results: z.array(
    z.object({
      results: z.array(RothCResultItemSchema),
      warnings: z.array(z.string()),
      errors: z.array(
        z.union([
          z.string(),
          z
            .object({})
            .loose()
            .transform((obj) => JSON.stringify(obj)),
        ]),
      ),
    }),
  ),
  processed_count: z.number().int().min(1),
});

export type ThuenenRunRResponseBatch = z.infer<
  typeof ThuenenRunRResponseBatchSchema
>;
