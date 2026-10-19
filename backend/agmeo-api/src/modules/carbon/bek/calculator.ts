/**
 * The BEK greenhouse-gas calculator (Berechnungsstandard für einzelbetriebliche
 * Klimabilanzen), ported verbatim from AGVOLUTION/agmeo src/lib/co2calculator/src/calculator.ts.
 * `calculator` turns one Co2eInput (per hectare) into kg CO2e/ha by emission source:
 * pf* field emissions, pb* upstream emissions of operating resources, pn* credits.
 */
import { addUnitToDetails } from './cite-sources.js';
import { emptyCo2eReport } from './empty.js';
import PARAMS from './parameters.js';
import type { ParameterKeys } from './parameters-sources.js';
import { parametersWithDetails } from './parameters-sources.js';
import type {
  Co2eCalculationExplanation,
  Co2eInput,
  Co2eReport,
  DeepPartial,
  fieldOrganicFertilizerData,
  SupportedCrops,
} from './types.js';
import { secondaryCrops } from './types.js';

export type { DeepPartial };

export type FunctionOutput = {
  value: number;
  details: Co2eCalculationExplanation[];
};

// The following are functions dependent on the crop and field emissions of which
// a) the harvest and root emissions
function pf5aN2OHarvestAndRoot(
  dryMassYield: number,
  byProductDry: number,
  ef: typeof PARAMS.ef,
  cf: typeof PARAMS.cf,
  gwp: typeof PARAMS.gwp,
  cropConst: (typeof PARAMS.crop)[SupportedCrops],
  crop: SupportedCrops,
): FunctionOutput {
  const rootDm =
    (dryMassYield + byProductDry) * 1000 * cropConst.rootProportion;
  const nContentRoot = rootDm * cropConst.nContentRoot;
  const co2e = nContentRoot * ef.n2oN * cf.n2oN2on * gwp.n2o;
  return {
    value: co2e,
    details: [
      {
        inputName: 'dryMassYield.and.byproductQuantity',
        inputValue: dryMassYield + byProductDry,
        inputUnit: 't/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: 1000,
            parameterName: 'conv.t.to.kg',
            parameterUnit: '',
          },
          {
            relationInputParameter: 'x',
            parameterValue: cropConst.rootProportion,
            parameterName: `crop.${crop}.rootProportion`,
            parameterUnit: 'kg root dry mass/kg yield',
          },
          {
            relationInputParameter: 'x',
            parameterValue: cropConst.nContentRoot,
            parameterName: `crop.${crop}.nContentRoot`,
            parameterUnit: 'kg N/kg root dry mass',
          },
          {
            relationInputParameter: 'x',
            parameterValue: ef.n2oN,
            parameterName: 'ef.n2oN',
            parameterUnit:
              parametersWithDetails['ef.n2oN']?.Einheit ?? 'kg CO2e/kg',
          },
          {
            relationInputParameter: 'x',
            parameterValue: cf.n2oN2on,
            parameterName: 'cf.n2oN2on',
            parameterUnit: 'kg CO2e/kg',
          },
          {
            relationInputParameter: 'x',
            parameterValue: gwp.n2o,
            parameterName: 'gwp.n2o',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: co2e,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pf5a',
        note: '',
      },
    ],
  };
}

function pf5bN2OFieldRestsExceptRoot(
  byproductQuantity: number,
  byproductRemoved: number,
  cropConst: (typeof PARAMS.crop)[SupportedCrops],
  params: typeof PARAMS,
  crop: SupportedCrops,
): FunctionOutput {
  const nByproductFm =
    byproductQuantity * (1 - byproductRemoved) * 1000 * cropConst.nByproductFm;
  const value =
    nByproductFm * params.ef.n2oN * params.cf.n2oN2on * params.gwp.n2o;
  const details: Co2eCalculationExplanation[] = [
    {
      inputName: 'byproductQuantity',
      inputValue: byproductQuantity,
      inputUnit: 't/ha',
      parameters: [
        {
          relationInputParameter: 'x',
          parameterValue: 1 - byproductRemoved,
          parameterName: '1- byProductRemoved',
          parameterUnit: '',
        },
        {
          relationInputParameter: 'x',
          parameterValue: 1000,
          parameterName: 'conv.t.to.kg',
          parameterUnit: '',
        },
        {
          relationInputParameter: 'x',
          parameterValue: cropConst.nByproductFm,
          parameterName: `crop.${crop}.nByproductFm`,
          parameterUnit: 'kg N/kg byproduct',
        },
        {
          relationInputParameter: 'x',
          parameterValue: PARAMS.ef.n2oN,
          parameterName: 'ef.n2oN',
          parameterUnit: 'kg CO2e/kg',
        },
        {
          relationInputParameter: 'x',
          parameterValue: PARAMS.cf.n2oN2on,
          parameterName: 'cf.n2oN2on',
          parameterUnit: 'kg CO2e/kg',
        },
        {
          relationInputParameter: 'x',
          parameterValue: PARAMS.gwp.n2o,
          parameterName: 'gwp.n2o',
          parameterUnit: 'kg CO2e/kg',
        },
      ],
      resultValue: value,
      resultUnit: 'kg CO₂e/ha',
      emissionSource: 'pf5b',
      note: '',
    },
  ];

  return { value, details };
}

// b) last year's data
function pf6N2OOrganicaLastYear(
  nLastYear: number,
  ef: typeof PARAMS.ef,
  cf: typeof PARAMS.cf,
  gwp: typeof PARAMS.gwp,
): FunctionOutput {
  const nLeft = nLastYear * 0.1;
  const co2eValue = nLeft * ef.n2oN * cf.n2oN2on * gwp.n2o;

  return {
    value: co2eValue,
    details: [
      {
        inputName: 'nLastYear',
        inputValue: nLastYear,
        inputUnit: 'kg N/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: 0.1,
            parameterName: '10% of nLastYear',
            parameterUnit: '',
          },
          {
            relationInputParameter: 'x',
            parameterValue: cf.n2oN2on,
            parameterName: 'cf.n2oN2on',
            parameterUnit: '',
          },
          {
            relationInputParameter: 'x',
            parameterValue: ef.n2oN,
            parameterName: 'ef.n2oN',
            parameterUnit: '',
          },
          {
            relationInputParameter: 'x',
            parameterValue: gwp.n2o,
            parameterName: 'gwp.n2o',
            parameterUnit: '',
          },
        ],
        resultValue: co2eValue,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pf6',
        note: '',
      },
    ],
  };
}
function pb2aNOrganicFertilizerDelivery(
  quantity: number,
  nOrganic: number,
  nEffectiveness: number,
  nLastYear: number,
  ef: typeof PARAMS.ef,
): FunctionOutput {
  const nKg = quantity * nOrganic;
  const ofe = (nEffectiveness * nKg) / 100 + nLastYear / 10;

  return {
    value: ofe * ef.supplyNOrganic,
    details: [
      {
        inputName: 'nLastYear',
        inputValue: nLastYear,
        inputUnit: 'kg N/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: 0.1,
            parameterName: '10% of nLastYear',
            parameterUnit: '',
          },
          {
            relationInputParameter: 'x',
            parameterValue: ef.supplyNOrganic,
            parameterName: 'ef.supplyNOrganic',
            parameterUnit: 'kg CO2e/kg N organic last year',
          },
        ],
        resultValue: nLastYear * 0.1 * ef.supplyNOrganic,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb2a',
        note: "10% of the nitrogen left from last year's fertilization multiplied by the emission factor for N2O emissions",
      },
      {
        inputName: 'quantity',
        inputValue: quantity,
        inputUnit: 'm³/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: nOrganic,
            parameterName: 'nOrganic',
            parameterUnit: 'kg N/m³',
          },
          {
            relationInputParameter: 'x',
            parameterValue: nEffectiveness,
            parameterName: 'nEffectiveness',
            parameterUnit: '%',
          },
          {
            relationInputParameter: 'x',
            parameterValue: ef.supplyNOrganic,
            parameterName: 'ef.supplyNOrganic',
            parameterUnit: 'kg CO2e/kg N organic last year',
          },
        ],
        resultValue: (ofe - nLastYear / 10) * ef.supplyNOrganic,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb2a',
        note: 'Nitrogen applied in kilograms per hectare multiplied by the emission factor for nitrogen',
      },
    ],
  };
}

// c) humus balance TODO check if it's C that comes in or humus, if it's C then * 0.090909
function pf9HumusBalance(
  humusBalance: number, //humus-c/ha, can be negative
  cf: typeof PARAMS.cf,
): FunctionOutput {
  return {
    value: humusBalance * cf.cCo2 * -1,
    details: [
      {
        inputName: 'humusBalance',
        inputValue: humusBalance,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: cf.cCo2,
            parameterName: 'cf.cCo2',
            parameterUnit: 'kg CO2e/kg',
          },
          {
            relationInputParameter: 'x',
            parameterValue: -1,
            parameterName: 'storingHumus',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: humusBalance * cf.cCo2 * -1,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pf9',
        note: 'Humus balance in humus carbon per hectare multiplied by the emission factor for CO2',
      },
    ],
  };
}
function pf10N2OHumus(
  humusBalance: number, //humus-c/ha
  nPerCHumus: number,
  cf: typeof PARAMS.cf,
  ef: typeof PARAMS.ef,
  gwp: typeof PARAMS.gwp,
): FunctionOutput {
  // If the humus balance is negative, then the N is released
  // Otherwise, if it's stored N apparently is NOT STORED
  // See excel A205 - E214 for the formula
  if (humusBalance >= 0) {
    return {
      value: 0,
      details: [],
    };
  }
  const nReleased = humusBalance * nPerCHumus;
  const co2e = nReleased * ef.n2oN * cf.n2oN2on * gwp.n2o * -1;
  return {
    value: co2e,
    details: [
      {
        inputName: 'humusBalance',
        inputValue: humusBalance,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: PARAMS.nPerCHumus,
            parameterName: 'nPerCHumus',
            parameterUnit: 'kg N/kg C',
          },
          {
            relationInputParameter: 'x',
            parameterValue: ef.n2oN,
            parameterName: 'ef.n2oN',
            parameterUnit: 'kg CO2e/kg',
          },
          {
            relationInputParameter: 'x',
            parameterValue: cf.n2oN2on,
            parameterName: 'cf.n2oN2on',
            parameterUnit: 'kg CO2e/kg',
          },
          {
            relationInputParameter: 'x',
            parameterValue: gwp.n2o,
            parameterName: 'gwp.n2o',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: co2e,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pf10',
        note: 'Humus balance in humus carbon per hectare multiplied by the emission factor for CO2',
      },
    ],
  };
}

// d) supply of seeds, pesticides
function pb4SeedSupply(
  supplySeed: number,
  cropConst: (typeof PARAMS.crop)[SupportedCrops],
  crop: SupportedCrops,
): FunctionOutput {
  // Here we need to take in consideration the crop
  return {
    value: supplySeed * cropConst.supplySeed,
    details: [
      {
        inputName: 'supplySeed',
        inputValue: supplySeed,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: cropConst.supplySeed,
            parameterName: `crop.${crop}.supplySeed`, // ef.{crop}.supplySeed
            parameterUnit: 'kg CO₂e/kg seed',
          },
        ],
        resultValue: supplySeed * cropConst.supplySeed,

        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb4',
        note: 'Seed supply in kilograms per hectare multiplied by the emission factor for seed supply',
      },
    ],
  };
}

function pb5PesticidesSupply(
  pesticidesQuantity: number,
  ef: typeof PARAMS.ef,
  pesticides: typeof PARAMS.pesticides,
): FunctionOutput {
  return {
    value:
      pesticidesQuantity *
      ef.supplyPesticides *
      pesticides.contentActiveIngredient,
    details: [
      {
        inputName: 'pesticidesQuantity',
        inputValue: pesticidesQuantity,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: pesticides.contentActiveIngredient * 100,
            parameterName: 'pesticides.contentActiveIngredient',
            parameterUnit: '',
          },
          {
            relationInputParameter: 'x',
            parameterValue: ef.supplyPesticides,
            parameterName: 'ef.supplyPesticides',
            parameterUnit: 'kg CO₂e/kg',
          },
        ],
        resultValue:
          pesticidesQuantity *
          ef.supplyPesticides *
          pesticides.contentActiveIngredient,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb5',
        note: 'Pesticides supply in kilograms per hectare multiplied by the emission factor for pesticides supply',
      },
    ],
  };
}

function pb6aDiesel(diesel: number, ef: typeof PARAMS.ef): FunctionOutput {
  return {
    value: diesel * ef.diesel,
    details: [
      {
        inputName: 'diesel',
        inputValue: diesel,
        inputUnit: 'l/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.diesel,
            parameterName: 'ef.diesel',
            parameterUnit: 'kg CO2e/l',
          },
        ],
        resultValue: diesel * ef.diesel,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb6a',
        note: 'Diesel consumption in liters per hectare multiplied by the emission factor for diesel',
      },
    ],
  };
}

function pb6bBiodiesel(biodiesel: number, ef: typeof PARAMS.ef): number {
  return biodiesel * ef.biodiesel;
}

function pb6aHVO100(hvo100: number, ef: typeof PARAMS.ef): FunctionOutput {
  return {
    value: hvo100 * ef.hvo100,
    details: [
      {
        inputName: 'HVO100',
        inputValue: hvo100,
        inputUnit: 'l/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.hvo100,
            parameterName: 'ef.hvo100',
            parameterUnit: 'kg CO2e/l',
          },
        ],
        resultValue: hvo100 * ef.hvo100,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb6a',
        note: 'HVO100 (Hydrotreated Vegetable Oil) consumption in liters per hectare multiplied by the emission factor for HVO100',
      },
    ],
  };
}

function pb7MachineManufacture(
  diesel: number,
  biodiesel: number,
  ef: typeof PARAMS.ef,
): FunctionOutput {
  return {
    value: (diesel + biodiesel) * ef.machineManufacture,
    details: [
      {
        inputName: 'diesel',
        inputValue: diesel,
        inputUnit: 'l/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.machineManufacture,
            parameterName: 'ef.machineManufacture',
            parameterUnit: 'kg CO2e/l',
          },
        ],
        resultValue: diesel * ef.machineManufacture,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb7',
        note: 'Diesel consumption in liters per hectare multiplied by the emission factor for diesel',
      },
    ],
  };
}

function pn1aByproductLeftOnField(
  byproductQuantity: number,
  byProductRemoved: number,
  cropConst: (typeof PARAMS.crop)[SupportedCrops],
  cf: typeof PARAMS.cf,
  crop: SupportedCrops,
): FunctionOutput {
  const byProductLeftOnField =
    byproductQuantity * (1 - byProductRemoved) * 1000; // in kg
  const value =
    byProductLeftOnField * cropConst.restsHumusBuildingPotential * cf.cCo2 * -1;
  const details: Co2eCalculationExplanation[] = [
    {
      inputName: 'byproductQuantity',
      inputValue: byproductQuantity,
      inputUnit: 't/ha',
      parameters: [
        {
          relationInputParameter: 'x',
          parameterValue: 1 - byProductRemoved,
          parameterName: '1- byProductRemoved',
          parameterUnit: '',
        },
        {
          relationInputParameter: 'x',
          parameterValue: 1000,
          parameterName: 'conv.t.to.kg',
          parameterUnit: '',
        },
        {
          relationInputParameter: 'x',
          parameterValue: cropConst.restsHumusBuildingPotential,
          parameterName: `crop.${crop}.dryMatterContentByproduct` as any,
          parameterUnit: 'kg C/kg byproduct',
        },
        {
          relationInputParameter: 'x',
          parameterValue: cf.cCo2,
          parameterName: 'cf.cCo2',
          parameterUnit: 'kg CO2e/kg',
        },
      ],
      resultValue: value,
      resultUnit: 'kg CO₂e/ha',
      emissionSource: 'pn1a',
      note: 'Byproduct left on field in kilograms per hectare multiplied by the humus building potential of the byproduct and the emission factor for CO2',
    },
  ];
  return { value, details };
}

function pn2aNReplacementValueNextCrop(
  nForNextCrop: number,
  ef: typeof PARAMS.ef,
): FunctionOutput {
  return {
    value: nForNextCrop * ef.nPrevious * -1,
    details: [
      {
        inputName: 'nForNextCrop',
        inputValue: nForNextCrop,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.nPrevious,
            parameterName: 'ef.nPrevious',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: nForNextCrop * ef.nPrevious * -1,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pn2a',
        note: 'Nitrogen applied in kilograms per hectare multiplied by the emission factor for nitrogen',
      },
    ],
  };
}

function pn2bP2o5ReplacementValueNextCrop(
  p2o5ForNextCrop: number,
  ef: typeof PARAMS.ef,
): FunctionOutput {
  return {
    value: p2o5ForNextCrop * ef.supplyP2O5 * -1,
    details: [
      {
        inputName: 'p2o5ForNextCrop',
        inputValue: p2o5ForNextCrop,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.supplyP2O5,
            parameterName: 'ef.supplyP2O5',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: p2o5ForNextCrop * ef.supplyP2O5 * -1,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pn2b',
        note: 'Phosphate applied in kilograms per hectare multiplied by the emission factor for phosphate',
      },
    ],
  };
}

function pn2cK2oReplacementValueNextCrop(
  k2oForNextCrop: number,
  ef: typeof PARAMS.ef,
): FunctionOutput {
  return {
    value: k2oForNextCrop * ef.supplyK2O * -1,
    details: [
      {
        inputName: 'k2oForNextCrop',
        inputValue: k2oForNextCrop,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.supplyK2O,
            parameterName: 'ef.supplyK2O',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: k2oForNextCrop * ef.supplyK2O * -1,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pn2c',
        note: 'Potassium applied in kilograms per hectare multiplied by the emission factor for potassium',
      },
    ],
  };
}

// The following are functions dependent on the organic fertilizers
function pf1N2OFromNh3Organic(
  nFromOrganic: number,
  nh3NProportion: number,
  quantityFarmManure: number,
  cf: typeof PARAMS.cf,
  gwp: typeof PARAMS.gwp,
  findOrganicFertilizerParameter: typeof PARAMS.findOrganicFertilizerParameter,
  organicFertilizerType: fieldOrganicFertilizerData['organicFertilizerType'],
  incorporationTime: fieldOrganicFertilizerData['incorporationTime'],
): FunctionOutput {
  // farmManureSpreadingEf
  const fEf = findOrganicFertilizerParameter(
    organicFertilizerType,
    incorporationTime,
  );
  // TAN content is N content * TAN proportion
  const nh3NContent = (nFromOrganic * nh3NProportion) / 100;
  // losses per m3 = content * spreading efficacy
  const nh3NApplicationLossesM3 = nh3NContent * fEf;
  // losses / ha = quantity applied * losses per unit of quantity
  const nh3NApplicationLossesHa = quantityFarmManure * nh3NApplicationLossesM3;

  // Constants TODO add this to constants
  const n2oNefAmmoniaDeposit = 0.01; // emission factor in kg N2O-N/kg NH3-N

  const value =
    nh3NApplicationLossesHa * n2oNefAmmoniaDeposit * cf.n2oN2on * gwp.n2o;
  const details: Co2eCalculationExplanation[] = [
    {
      inputName: 'nFromOrganic',
      inputValue: nFromOrganic,
      inputUnit: 'kg/m³',
      parameters: [
        {
          relationInputParameter: 'x',
          parameterValue: nh3NProportion / 100, // To show it in %
          parameterName: 'nh3NProportion',
          parameterUnit: '%',
        },
        {
          relationInputParameter: 'x',
          parameterValue: fEf,
          parameterName: `orgFertParams.${organicFertilizerType}.${incorporationTime}`,
          parameterUnit: '', // is NH3-N · (kg TAN)-1 comes from addUnitToDetails
        },
        {
          relationInputParameter: 'x',
          parameterValue: quantityFarmManure,
          parameterName: 'quantityFarmManure',
          parameterUnit: 'm³/ha',
        },
        {
          relationInputParameter: 'x',
          parameterValue: n2oNefAmmoniaDeposit,
          parameterName: 'n2oNefAmmoniaDeposit',
          parameterUnit: 'kg N2O-N/kg NH3-N',
        },
        {
          relationInputParameter: 'x',
          parameterValue: cf.n2oN2on,
          parameterName: 'cf.n2oN2on',
          parameterUnit: 'kg CO2e/kg',
        },
        {
          relationInputParameter: 'x',
          parameterValue: gwp.n2o,
          parameterName: 'gwp.n2o',
          parameterUnit: 'kg CO2e/kg',
        },
      ],
      resultValue: value,
      resultUnit: 'kg CO₂e/ha',
      emissionSource: 'pf1',
      note: '',
    },
  ];
  return { value, details };
}

function pf3N2OFromOrganic(
  quantity: number,
  nFromOrganic: number,
  nEffectiveness: number,
  ef: typeof PARAMS.ef,
  cf: typeof PARAMS.cf,
  gwp: typeof PARAMS.gwp,
): FunctionOutput {
  const nKgHa = quantity * nFromOrganic;
  const ofe = (nEffectiveness * nKgHa) / 100;

  const value = ofe * ef.n2oN * cf.n2oN2on * gwp.n2o;
  const details: Co2eCalculationExplanation[] = [
    {
      inputName: 'nFromOrganic',
      inputValue: nKgHa,
      inputUnit: 'kg/ha',
      parameters: [
        {
          relationInputParameter: 'x',
          parameterValue: ef.n2oN,
          parameterName: 'ef.n2oN',
          parameterUnit: 'kg CO2e/kg',
        },
        {
          relationInputParameter: 'x',
          parameterValue: cf.n2oN2on,
          parameterName: 'cf.n2oN2on',
          parameterUnit: 'kg CO2e/kg',
        },
        {
          relationInputParameter: 'x',
          parameterValue: gwp.n2o,
          parameterName: 'gwp.n2o',
          parameterUnit: 'kg CO2e/kg',
        },
      ],
      resultValue: value,
      resultUnit: 'kg CO₂e/ha',
      emissionSource: 'pf3',
      note: '',
    },
  ];
  return { value, details };
}

function pb2bP2O5OrganicFertilizerDelivery(
  quantity: number,
  p2o5Organic: number, // kg/m^3
  ef: typeof PARAMS.ef,
): FunctionOutput {
  const p2o5Ha = quantity * p2o5Organic; // kg/ha = m^3/ha * kg/m^3
  const value = p2o5Ha * ef.supplyP2O5;
  const details: Co2eCalculationExplanation[] = [
    {
      inputName: 'P2O5',
      inputValue: p2o5Ha,
      inputUnit: 'kg/ha',
      parameters: [
        {
          relationInputParameter: 'x',
          parameterValue: ef.supplyP2O5,
          parameterName: 'ef.supplyP2O5',
          parameterUnit: 'kg CO2e/kg',
        },
      ],
      resultValue: value,
      resultUnit: 'kg CO₂e/ha',
      emissionSource: 'pb2b',
      note: 'Phosphate applied in kilograms per hectare multiplied by the emission factor for phosphate',
    },
  ];

  return { value, details };
}
function pb2cK2oOrganicFertilizerDelivery(
  quantity: number,
  k2oOrganic: number, // kg/m^3
  ef: typeof PARAMS.ef,
): FunctionOutput {
  const k2oHa = quantity * k2oOrganic; // kg/ha = m^3/ha * kg/m^3
  const value = k2oHa * ef.supplyK2O;
  const details: Co2eCalculationExplanation[] = [
    {
      inputName: 'K2O',
      inputValue: k2oHa,
      inputUnit: 'kg/ha',
      parameters: [
        {
          relationInputParameter: 'x',
          parameterValue: ef.supplyK2O,
          parameterName: 'ef.supplyK2O',
          parameterUnit: 'kg CO2e/kg',
        },
      ],
      resultValue: value,
      resultUnit: 'kg CO₂e/ha',
      emissionSource: 'pb2c',
      note: 'Potassium applied in kilograms per hectare multiplied by the emission factor for potassium',
    },
  ];
  return { value, details };
}

// The following are functions dependent on the mineral fertilizers
function pb1aNMineralFertilizerProduction(
  appliedUreaNHectare: number,
  appliedUanNHectare: number,
  appliedOthersMineralNHectare: number,
  category: string,
  ef: typeof PARAMS.ef,
  customNEmissionManufacture?: number,
): FunctionOutput {
  const specificUreaSupply =
    category === 'UREA_W_INHIBITOR_BLUE'
      ? ef.supplyGreenFertilizer
      : category === 'UREA_W_INHIBITOR_BLUE_LIQUID'
        ? ef.supplyGreenFertilizerLiquid
        : ef.supplyUrea;
  const specificUreaSupplyString =
    category === 'UREA_W_INHIBITOR_BLUE'
      ? 'ef.supplyGreenFertilizer'
      : category === 'UREA_W_INHIBITOR_BLUE_LIQUID'
        ? 'ef.supplyGreenFertilizerLiquid'
        : 'ef.supplyUrea';

  // This was a PoC, better not touch it
  let fertilizerSupply = ef.otherMineralN;
  let fertilizerSupplyString = 'ef.otherMineralN';
  if (category === 'CARBON_LIGHT') {
    fertilizerSupply = 0.463;
    fertilizerSupplyString = 'ef.supplyCarbonLight';
  }

  if (customNEmissionManufacture) {
    fertilizerSupply = customNEmissionManufacture;
    fertilizerSupplyString = 'customNEmissionManufacture';
  }

  return {
    value:
      appliedUreaNHectare * specificUreaSupply +
      appliedUanNHectare * ef.supplyUan +
      appliedOthersMineralNHectare * fertilizerSupply,
    details: [
      {
        inputName: 'Supply of urea',
        inputValue: appliedUreaNHectare,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: specificUreaSupply,
            parameterName: specificUreaSupplyString,
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: appliedUreaNHectare * specificUreaSupply,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb1a',
        note: 'Urea applied in kilograms per hectare multiplied by the emission factor for urea',
      },
      {
        inputName: 'Supply of UAN',
        inputValue: appliedUanNHectare,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.supplyUan,
            parameterName: 'ef.supplyUan',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: appliedUanNHectare * ef.supplyUan,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb1a',
        note: 'UAN applied in kilograms per hectare multiplied by the emission factor for UAN',
      },
      {
        inputName: 'n_content',
        inputValue: appliedOthersMineralNHectare,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: fertilizerSupply,
            parameterName: fertilizerSupplyString,
            parameterUnit: 'kg CO2e/kg N',
          },
        ],
        resultValue: appliedOthersMineralNHectare * fertilizerSupply,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb1a',
        note: 'Other mineral fertilizers applied in kilograms per hectare multiplied by the emission factor for other mineral fertilizers',
      },
    ],
  };
}
function pb1bPhosphateMineralFertilizerProduction(
  p2o5Mineral: number,
  ef: typeof PARAMS.ef,
): FunctionOutput {
  return {
    value: p2o5Mineral * ef.supplyP2O5,
    details: [
      {
        inputName: 'P2O5',
        inputValue: p2o5Mineral,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.supplyP2O5,
            parameterName: 'ef.supplyP2O5',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: p2o5Mineral * ef.supplyP2O5,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb1b',
        note: 'Phosphate applied in kilograms per hectare multiplied by the emission factor for phosphate',
      },
    ],
  };
}

function pb1cK2oMineralFertilizerProduction(
  k2oMineral: number,
  ef: typeof PARAMS.ef,
): FunctionOutput {
  return {
    value: k2oMineral * ef.supplyK2O,
    details: [
      {
        inputName: 'K2O',
        inputValue: k2oMineral,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.supplyK2O,
            parameterName: 'ef.supplyK2O',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: k2oMineral * ef.supplyK2O,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb1c',
        note: 'Potassium applied in kilograms per hectare multiplied by the emission factor for potassium',
      },
    ],
  };
}

function pb1dLimeMineralFertilizerProduction(
  appliedLimeNHectare: number,
  ef: typeof PARAMS.ef,
): FunctionOutput {
  return {
    value: appliedLimeNHectare * ef.supplyCao,
    details: [
      {
        inputName: 'CaO',
        inputValue: appliedLimeNHectare,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.supplyCao,
            parameterName: 'ef.supplyCao',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: appliedLimeNHectare * ef.supplyCao,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pb1d',
        note: 'Lime applied in kilograms per hectare multiplied by the emission factor for lime',
      },
    ],
  };
}
function pf2N2OFromNh3Mineral(
  n_content: number,
  fertilizerMineralType: string | null,
  params: typeof PARAMS,
): FunctionOutput {
  let nh3_n_ef_applied_n: number;
  let parameterName: ParameterKeys;
  if (fertilizerMineralType?.includes('NP')) {
    nh3_n_ef_applied_n = params.ef.appliedN.np;
    parameterName = 'ef.appliedN.np';
  } else if (fertilizerMineralType?.includes('UREA_W_INHIBITOR')) {
    // Check UREA_W_INHIBITOR before UREA to avoid false positive
    nh3_n_ef_applied_n = params.ef.appliedN.ureaWithInhibitor;
    parameterName = 'ef.appliedN.ureaWithInhibitor';
  } else if (fertilizerMineralType?.includes('UREA')) {
    nh3_n_ef_applied_n = params.ef.appliedN.urea;
    parameterName = 'ef.appliedN.urea';
  } else if (fertilizerMineralType?.includes('CAN_AND_OTHERS_N')) {
    nh3_n_ef_applied_n = params.ef.appliedN.canAndOthersN;
    parameterName = 'ef.appliedN.canAndOthersN';
  } else if (fertilizerMineralType?.includes('AHL')) {
    nh3_n_ef_applied_n = params.ef.appliedN.ahl;
    parameterName = 'ef.appliedN.ahl';
  } else {
    nh3_n_ef_applied_n = params.ef.appliedN.others;
    parameterName = 'ef.appliedN.others';
  }

  // Calculating
  const nh3_n_application_losses = nh3_n_ef_applied_n * n_content;

  // Constants
  const n2o_n_ef_ammonia_deposit = 0.01; // emission factor in kg N2O-N/kg NH3-N

  const co2e =
    nh3_n_application_losses *
    n2o_n_ef_ammonia_deposit *
    params.cf.n2oN2on *
    params.gwp.n2o;

  return {
    value: co2e,
    details: [
      {
        inputName: 'n_content',
        inputValue: n_content,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: nh3_n_ef_applied_n,
            parameterName,
            parameterUnit: 'kg N/ha',
          },
          {
            relationInputParameter: 'x',
            parameterValue: n2o_n_ef_ammonia_deposit,
            parameterName: 'n2o_n_ef_ammonia_deposit',
            parameterUnit: 'kg N2O-N/kg NH3-N',
          },
          {
            relationInputParameter: 'x',
            parameterValue: PARAMS.cf.n2oN2on,
            parameterName: 'cf.n2oN2on',
            parameterUnit: '',
          },
          {
            relationInputParameter: 'x',
            parameterValue: PARAMS.gwp.n2o,
            parameterName: 'gwp.n2o',
            parameterUnit: '',
          },
        ],
        resultValue: co2e,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pf2',
        note: '',
      },
    ],
  };
}

function pf4N2OFromMineral(
  nContent: number,
  ef: typeof PARAMS.ef,
  cf: typeof PARAMS.cf,
  gwp: typeof PARAMS.gwp,
): FunctionOutput {
  return {
    value: nContent * ef.n2oN * cf.n2oN2on * gwp.n2o,
    details: [
      {
        inputName: 'nContent',
        inputValue: nContent,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.n2oN,
            parameterName: 'ef.n2oN',
            parameterUnit: 'kg CO2e/kg',
          },
          {
            relationInputParameter: 'x',
            parameterValue: cf.n2oN2on,
            parameterName: 'cf.n2oN2on',
            parameterUnit: 'kg CO2e/kg',
          },
          {
            relationInputParameter: 'x',
            parameterValue: gwp.n2o,
            parameterName: 'gwp.n2o',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: nContent * ef.n2oN * cf.n2oN2on * gwp.n2o,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pf4',
        note: 'N content in kilograms per hectare multiplied by the emission factor for N2O emissions',
      },
    ],
  };
}

function pf8aLime(
  limeYearlyAverage: number,
  ef: typeof PARAMS.ef,
): FunctionOutput {
  return {
    value: limeYearlyAverage * ef.cao,
    details: [
      {
        inputName: 'CaO',
        inputValue: limeYearlyAverage,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.cao,
            parameterName: 'ef.cao',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: limeYearlyAverage * ef.cao,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pf8a',
        note: 'Lime applied in kilograms per hectare multiplied by the emission factor for lime',
      },
    ],
  };
}

function pf8bUrea(
  appliedUreaNHectare: number,
  ef: typeof PARAMS.ef,
): FunctionOutput {
  return {
    value: appliedUreaNHectare * ef.urea,
    details: [
      {
        inputName: 'Urea',
        inputValue: appliedUreaNHectare,
        inputUnit: 'kg/ha',
        parameters: [
          {
            relationInputParameter: 'x',
            parameterValue: ef.urea,
            parameterName: 'ef.urea',
            parameterUnit: 'kg CO2e/kg',
          },
        ],
        resultValue: appliedUreaNHectare * ef.urea,
        resultUnit: 'kg CO₂e/ha',
        emissionSource: 'pf8b',
        note: 'Urea applied in kilograms per hectare multiplied by the emission factor for urea',
      },
    ],
  };
}

// Function to deeply merge two objects
function deepMerge<T extends object>(target: T, source: DeepPartial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] instanceof Object && key in target) {
      result[key] = deepMerge(target[key] as any, source[key] as any);
    } else {
      result[key] = source[key] as any;
    }
  }
  return result;
}

// Function to iterate trough the years and merge the parameters
// Earlier years will be overwritten by the later ones
function mergeYearParameters(year: number): typeof PARAMS {
  const years = Object.keys(PARAMS.yearParameters)
    .map(Number)
    .filter((y) => y <= year)
    .sort((a, b) => a - b);

  const yearParams = years.reduce(
    (acc, y) => {
      const p = PARAMS.yearParameters[y as keyof typeof PARAMS.yearParameters];
      if (p) {
        acc = deepMerge(acc, p as DeepPartial<typeof PARAMS>);
      }
      return acc;
    },
    {} as typeof PARAMS,
  );

  return deepMerge(PARAMS, yearParams);
}

function mergeYearAndNewParameters(
  year?: number,
  newParams?: DeepPartial<typeof PARAMS>,
): typeof PARAMS {
  const yearParams = year ? mergeYearParameters(year) : PARAMS;
  return newParams ? deepMerge(yearParams, newParams) : yearParams;
}

function getYearParameterChanges(year?: number): Record<string, string> {
  const cp: Record<string, string> = {};
  if (!year) {
    return {};
  }

  // Gather all years up to and including `year`
  const years = Object.keys(PARAMS.yearParameters)
    .map(Number)
    .filter((y) => y <= year)
    .sort((a, b) => a - b);

  // recurse into any nested object and record leaf paths
  function recurse(obj: any, prefix: string, y: number) {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      const path = prefix ? `${prefix}.${key}` : key;

      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        // nested object: keep diving
        recurse(val, path, y);
      } else {
        // leaf: record "path" → "year.path"
        cp[path] = `${y}.${path}`;
      }
    }
  }

  // for each year’s override object, walk it
  for (const y of years) {
    const overrides =
      PARAMS.yearParameters[y as keyof typeof PARAMS.yearParameters];
    if (overrides) {
      recurse(overrides, '', y);
    }
  }

  return cp;
}

export function calculator(
  input: Co2eInput,
  newParams?: DeepPartial<typeof PARAMS>,
  year?: number,
): Co2eReport {
  // Create an empty Co2eReport object
  const co2eReport: Co2eReport = structuredClone(emptyCo2eReport);

  const params = mergeYearAndNewParameters(year, newParams);
  const changesLog = getYearParameterChanges(year);

  // If the data was not given by the extractor, set it to 0
  input.fieldData.byproductRemoved ??= 0;
  input.fieldData.byProductWet ??= 0;
  input.fieldData.nForNextCrop ??= 0;
  input.fieldData.p2o5ForNextCrop ??= 0;
  input.fieldData.k2oForNextCrop ??= 0;

  // Crop and field emissions
  const crop = input.fieldData.crop;
  const cropParams = params.crop[input.fieldData.crop];
  if (secondaryCrops.includes(input.fieldData.crop)) {
    input.fieldData.byProductWet =
      input.fieldData.dryMassYield * (1 / cropParams.dryMatterContent);
    input.fieldData.dryMassYield = 0;
  }

  const byProductDry =
    (input.fieldData.byProductWet *
      cropParams.dryMatterContentByproduct *
      100) /
    100; // Yes, I know I divided by 100 and then multiplied by 100, but it's to make it clear that it's a percentage
  co2eReport.details.push({
    inputName: 'byProductWet',
    inputValue: input.fieldData.byProductWet,
    inputUnit: 't/ha',
    parameters: [
      {
        relationInputParameter: 'x',
        parameterValue: cropParams.dryMatterContentByproduct * 100,
        parameterName: `crop.${crop}.dryMatterContentByproduct`,
        parameterUnit: '%',
      },
    ],
    resultValue: byProductDry,
    resultUnit: 't.byProductDry',
    note: 'Byproduct wet in tons per hectare converted to dry matter',
  });

  const pf5aN2OHarvestAndRootCo2e = pf5aN2OHarvestAndRoot(
    input.fieldData.crop === 'sugarBeet' ||
      input.fieldData.crop.toLowerCase().includes('potato')
      ? 0
      : input.fieldData.dryMassYield,
    byProductDry,
    params.ef,
    params.cf,
    params.gwp,
    cropParams,
    crop,
  );
  const pf5bN2OFieldRestsExceptRootCo2e = pf5bN2OFieldRestsExceptRoot(
    input.fieldData.byProductWet,
    input.fieldData.byproductRemoved,
    cropParams,
    params,
    crop,
  );
  const pf6N2OOrganicaLastYearCo2e = pf6N2OOrganicaLastYear(
    input.fieldData.nLastYear,
    params.ef,
    params.cf,
    params.gwp,
  );
  const pf9HumusBalanceCo2e = pf9HumusBalance(
    input.fieldData.humusBalance,
    params.cf,
  );
  const pf10N2OHumusCo2e = pf10N2OHumus(
    input.fieldData.humusBalance,
    params.nPerCHumus,
    params.cf,
    params.ef,
    params.gwp,
  );

  const pb2aNOrganicFertilizerDeliveryLastYearCo2e =
    pb2aNOrganicFertilizerDelivery(
      0,
      0,
      0,
      input.fieldData.nLastYear,
      params.ef,
    );
  const pb4SeedSupplyCo2e = pb4SeedSupply(
    input.fieldData.supplySeed,
    cropParams,
    crop,
  );
  const pb5PesticidesSupplyCo2e = pb5PesticidesSupply(
    input.fieldData.pesticidesQuantity,
    params.ef,
    params.pesticides,
  );
  const pb6aDieselCo2e = pb6aDiesel(input.fieldData.diesel, params.ef);

  const pb6bBiodieselCo2e = pb6bBiodiesel(input.fieldData.biodiesel, params.ef);
  const pb6aHVO100Co2e = pb6aHVO100(input.fieldData.HVO100 || 0, params.ef);
  const pb7MachineManufactureCo2e = pb7MachineManufacture(
    input.fieldData.diesel,
    input.fieldData.biodiesel,
    params.ef,
  );

  const pn1aByproductLeftOnFieldCo2e = pn1aByproductLeftOnField(
    input.fieldData.byProductWet,
    input.fieldData.byproductRemoved,
    cropParams,
    params.cf,
    crop,
  );

  const pn2aNReplacementValueNextCropCo2e = pn2aNReplacementValueNextCrop(
    input.fieldData.nForNextCrop,
    params.ef,
  );
  const pn2bP2o5ReplacementValueNextCropCo2e = pn2bP2o5ReplacementValueNextCrop(
    input.fieldData.p2o5ForNextCrop,
    params.ef,
  );
  const pn2cK2oReplacementValueNextCropCo2e = pn2cK2oReplacementValueNextCrop(
    input.fieldData.k2oForNextCrop,
    params.ef,
  );

  co2eReport.byId.pf5a = pf5aN2OHarvestAndRootCo2e.value;
  co2eReport.details = co2eReport.details.concat(
    pf5aN2OHarvestAndRootCo2e.details,
  );
  co2eReport.byId.pf5b = pf5bN2OFieldRestsExceptRootCo2e.value;
  co2eReport.details = co2eReport.details.concat(
    pf5bN2OFieldRestsExceptRootCo2e.details,
  );
  co2eReport.byId.pf6 = pf6N2OOrganicaLastYearCo2e.value;
  co2eReport.details = co2eReport.details.concat(
    pf6N2OOrganicaLastYearCo2e.details,
  );
  co2eReport.byId.pf9 = pf9HumusBalanceCo2e.value;
  co2eReport.details = co2eReport.details.concat(pf9HumusBalanceCo2e.details);
  co2eReport.byId.pf10 = pf10N2OHumusCo2e.value;
  co2eReport.details = co2eReport.details.concat(pf10N2OHumusCo2e.details);
  // Last year
  co2eReport.byId.pb2a += pb2aNOrganicFertilizerDeliveryLastYearCo2e.value;
  co2eReport.details = co2eReport.details.concat(
    pb2aNOrganicFertilizerDeliveryLastYearCo2e.details,
  );
  co2eReport.byId.pb4 += pb4SeedSupplyCo2e.value;
  co2eReport.details = co2eReport.details.concat(pb4SeedSupplyCo2e.details);
  co2eReport.byId.pb5 += pb5PesticidesSupplyCo2e.value;
  co2eReport.details = co2eReport.details.concat(
    pb5PesticidesSupplyCo2e.details,
  );
  co2eReport.byId.pb6a += pb6aDieselCo2e.value;
  co2eReport.details = co2eReport.details.concat(pb6aDieselCo2e.details);
  co2eReport.byId.pb6b += pb6bBiodieselCo2e;
  co2eReport.byId.pb6a += pb6aHVO100Co2e.value;
  co2eReport.details = co2eReport.details.concat(pb6aHVO100Co2e.details);
  co2eReport.byId.pb7 += pb7MachineManufactureCo2e.value;
  co2eReport.details = co2eReport.details.concat(
    pb7MachineManufactureCo2e.details,
  );

  co2eReport.byId.pn1a += pn1aByproductLeftOnFieldCo2e.value;
  co2eReport.details = co2eReport.details.concat(
    pn1aByproductLeftOnFieldCo2e.details,
  );
  co2eReport.byId.pn1b += 0; //pn1bByproductLeftOnFieldCo2e.value;
  /*co2eReport.details = 
    co2eReport.details.concat(
        pn1bByproductLeftOnFieldCo2e.details,
    );*/
  co2eReport.byId.pn2a += pn2aNReplacementValueNextCropCo2e.value;
  co2eReport.details = co2eReport.details.concat(
    pn2aNReplacementValueNextCropCo2e.details,
  );
  co2eReport.byId.pn2b += pn2bP2o5ReplacementValueNextCropCo2e.value;
  co2eReport.details = co2eReport.details.concat(
    pn2bP2o5ReplacementValueNextCropCo2e.details,
  );
  co2eReport.byId.pn2c += pn2cK2oReplacementValueNextCropCo2e.value;
  co2eReport.details = co2eReport.details.concat(
    pn2cK2oReplacementValueNextCropCo2e.details,
  );

  // Organic fertilizers emissions TODO:
  for (const organicFertilizerItem of input.fieldOrganicFertilizerData) {
    const organicFertilizerKey = Object.keys(organicFertilizerItem)[0];
    const organicFertilizer = organicFertilizerItem[organicFertilizerKey];

    const pf1N2OFromNh3OrganicCo2e = pf1N2OFromNh3Organic(
      organicFertilizer.nFromOrganic,
      organicFertilizer.nh3NProportion,
      organicFertilizer.quantityFarmManure,
      params.cf,
      params.gwp,
      params.findOrganicFertilizerParameter,
      organicFertilizer.organicFertilizerType,
      organicFertilizer.incorporationTime,
    );

    const pf3N2OFromOrganicCo2e = pf3N2OFromOrganic(
      organicFertilizer.quantityFarmManure,
      organicFertilizer.nFromOrganic,
      organicFertilizer.nEffectiveness,
      params.ef,
      params.cf,
      params.gwp,
    );
    const pb2bP2O5OrganicFertilizerDeliveryThisYearCo2e =
      pb2bP2O5OrganicFertilizerDelivery(
        organicFertilizer.quantityFarmManure,
        organicFertilizer.p2o5Organic,
        params.ef,
      );
    const pb2cK2oOrganicFertilizerDeliveryThisYearCo2e =
      pb2cK2oOrganicFertilizerDelivery(
        organicFertilizer.quantityFarmManure,
        organicFertilizer.k2oOrganic,
        params.ef,
      );

    const pb2aNOrganicFertilizerDeliveryThisYearCo2e =
      pb2aNOrganicFertilizerDelivery(
        organicFertilizer.quantityFarmManure,
        organicFertilizer.nFromOrganic,
        organicFertilizer.nEffectiveness,
        0,
        params.ef,
      );
    co2eReport.byId.pf1 += pf1N2OFromNh3OrganicCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pf1N2OFromNh3OrganicCo2e.details,
    );
    co2eReport.byId.pb2a += pb2aNOrganicFertilizerDeliveryThisYearCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pb2aNOrganicFertilizerDeliveryThisYearCo2e.details,
    );
    co2eReport.byId.pf3 += pf3N2OFromOrganicCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pf3N2OFromOrganicCo2e.details,
    );

    co2eReport.byId.pb2b += pb2bP2O5OrganicFertilizerDeliveryThisYearCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pb2bP2O5OrganicFertilizerDeliveryThisYearCo2e.details,
    );
    co2eReport.byId.pb2c += pb2cK2oOrganicFertilizerDeliveryThisYearCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pb2cK2oOrganicFertilizerDeliveryThisYearCo2e.details,
    );
  }

  // Mineral fertilizers emissions
  for (const mineralFertilizerItem of input.fieldMineralFertilizerData) {
    const mineralFertilizerKey = Object.keys(mineralFertilizerItem)[0];
    const mineralFertilizer = mineralFertilizerItem[mineralFertilizerKey];
    const pb1aNMineralFertilizerProductionCo2e =
      pb1aNMineralFertilizerProduction(
        mineralFertilizer.appliedUreaNHectare,
        mineralFertilizer.appliedUanNHectare,
        mineralFertilizer.appliedOthersMineralNHectare,
        mineralFertilizer.fertilizerMineralType,
        params.ef,
        mineralFertilizer.nEmissionsManufacturing,
      );
    const pb1bPhosphateMineralFertilizerProductionCo2e =
      pb1bPhosphateMineralFertilizerProduction(
        mineralFertilizer.p2o5Mineral,
        params.ef,
      );
    const pb1dLimeMineralFertilizerProductionCo2e =
      pb1dLimeMineralFertilizerProduction(
        mineralFertilizer.limeYearlyAverage,
        params.ef,
      );
    const pb1cK2oMineralFertilizerProductionCo2e =
      pb1cK2oMineralFertilizerProduction(
        mineralFertilizer.k2oMineral,
        params.ef,
      );
    const pf2N2OFromNh3MineralCo2e = pf2N2OFromNh3Mineral(
      mineralFertilizer.appliedOthersMineralNHectare +
        mineralFertilizer.appliedUanNHectare +
        mineralFertilizer.appliedUreaNHectare,
      mineralFertilizer.fertilizerMineralType,
      params,
    );
    const pf4N2OFromMineralCo2e = pf4N2OFromMineral(
      mineralFertilizer.appliedOthersMineralNHectare +
        mineralFertilizer.appliedUanNHectare +
        mineralFertilizer.appliedUreaNHectare,
      params.ef,
      params.cf,
      params.gwp,
    );
    const pf8aLimeFertilizationCo2e = pf8aLime(
      mineralFertilizer.limeYearlyAverage,
      params.ef,
    );
    const pf8bUreaFertilizationCo2e = pf8bUrea(
      mineralFertilizer.appliedUreaNHectare,
      params.ef,
    );

    co2eReport.byManagement!.byProduct.mineral.mineralFertilizerKey =
      pb1aNMineralFertilizerProductionCo2e.value +
      pb1bPhosphateMineralFertilizerProductionCo2e.value +
      pb1cK2oMineralFertilizerProductionCo2e.value +
      pb1dLimeMineralFertilizerProductionCo2e.value +
      pf2N2OFromNh3MineralCo2e.value +
      pf4N2OFromMineralCo2e.value +
      pf8aLimeFertilizationCo2e.value +
      pf8bUreaFertilizationCo2e.value;

    co2eReport.byId.pb1a += pb1aNMineralFertilizerProductionCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pb1aNMineralFertilizerProductionCo2e.details,
    );

    co2eReport.byId.pb1b += pb1bPhosphateMineralFertilizerProductionCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pb1bPhosphateMineralFertilizerProductionCo2e.details,
    );
    co2eReport.byId.pb1c += pb1cK2oMineralFertilizerProductionCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pb1cK2oMineralFertilizerProductionCo2e.details,
    );
    co2eReport.byId.pb1d += pb1dLimeMineralFertilizerProductionCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pb1dLimeMineralFertilizerProductionCo2e.details,
    );
    co2eReport.byId.pf2 += pf2N2OFromNh3MineralCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pf2N2OFromNh3MineralCo2e.details,
    );
    co2eReport.byId.pf4 += pf4N2OFromMineralCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pf4N2OFromMineralCo2e.details,
    );

    co2eReport.byId.pf8a += pf8aLimeFertilizationCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pf8aLimeFertilizationCo2e.details,
    );
    co2eReport.byId.pf8b += pf8bUreaFertilizationCo2e.value;
    co2eReport.details = co2eReport.details.concat(
      pf8bUreaFertilizationCo2e.details,
    );
  }

  // Remove all details with 0 resultValue
  co2eReport.details = co2eReport.details.filter(
    (detail) => detail.resultValue !== 0,
  );

  co2eReport.details = addUnitToDetails(co2eReport.details);

  // Add year to the details
  co2eReport.details.forEach((detail) => {
    detail.parameters.forEach((parameter) => {
      if (parameter.parameterName in changesLog) {
        parameter.parameterName = changesLog[parameter.parameterName];
      }
    });
  });

  // Total
  co2eReport.total =
    Object.values(co2eReport.byId).reduce((acc, cur) => acc + cur) -
    co2eReport.byId.pn1b;

  return co2eReport;
}
