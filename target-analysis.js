"use strict";

window.cpiCreateTargetAnalysis = function(options) {
  const { rows, predModes: targetPredModes, outcomes: targetPredModeOutcomes, featureNames: targetFeatureNames, featureVector: targetGetFeatureVector, number: targetGetNumericValue, sigmoid: targetSigmoid } = options;
  const targetFeatureDeltaLambda = 10, targetFeatureDeltaIterations = 50, targetFeatureDeltaTolerance = 0.00001;
  const targetState = { rows, rowsByChartId: new Map(rows.map(row => [String(row.chart_id), row])), records: new Map() };
  let lastKey = null, lastResult = null;
function targetGetPredObservations(mode = "normal") {
  const observations = [];
  const modes = mode === "overall"
    ? Object.keys(targetPredModes)
    : [targetPredModes[mode] ? mode : "normal"];
  targetState.records.forEach((record, chartId) => {
    const row = targetState.rowsByChartId.get(String(chartId));
    if (!row) {
      return;
    }
    const status = String(record?.status ?? "").toLowerCase();
    modes.forEach((predMode) => {
      const definition = targetPredModes[predMode];
      const outcomes = targetPredModeOutcomes[predMode];
      const pred = targetGetNumericValue(row[definition.key]);
      const outcome = outcomes.clear.has(status)
        ? 1
        : outcomes.notClear.has(status)
          ? 0
          : null;
      if (pred !== null && outcome !== null) {
        observations.push({ row, pred, outcome, mode: predMode });
      }
    });
  });
  return observations;
}

function targetGetModelBounds(mode, observations) {
  const keys = mode === "overall"
    ? Object.values(targetPredModes).map((definition) => definition.key)
    : [targetPredModes[mode]?.key ?? targetPredModes.normal.key];
  const values = targetState.rows
    .flatMap((row) => keys.map((key) => targetGetNumericValue(row[key])))
    .filter((value) => value !== null);
  const observedValues = observations.map((observation) => observation.pred).filter(Number.isFinite);
  const fallbackValues = values.length > 0 ? values : observedValues;
  return {
    min: fallbackValues.length > 0 ? Math.min(...fallbackValues) : 0,
    max: fallbackValues.length > 0 ? Math.max(...fallbackValues) : 0,
  };
}

function targetFitBaseModel(observations, mode = "normal") {
  const observedChartCount = new Set(observations.map((observation) => String(observation.row?.chart_id ?? "").trim())).size;
  const clearObservations = observations.filter((observation) => observation.outcome === 1);
  const notClearObservations = observations.filter((observation) => observation.outcome === 0);
  if (observedChartCount < 5 || clearObservations.length === 0 || notClearObservations.length === 0) {
    return null;
  }

  const center = observations.reduce((total, observation) => total + observation.pred, 0) / observations.length;
  const variance = observations.reduce((total, observation) => total + (observation.pred - center) ** 2, 0) / observations.length;
  const scale = Math.max(Math.sqrt(variance), 0.25);
  const clearAverage = clearObservations.reduce((total, observation) => total + observation.pred, 0) / clearObservations.length;
  const notClearAverage = notClearObservations.reduce((total, observation) => total + observation.pred, 0) / notClearObservations.length;
  if (clearAverage > notClearAverage) {
    return null;
  }

  const clearRate = Math.min(0.95, Math.max(0.05, clearObservations.length / observations.length));
  let intercept = Math.log(clearRate / (1 - clearRate));
  let slope = -1;
  const regularization = 0.03;

  for (let iteration = 0; iteration < 80; iteration += 1) {
    let gradientIntercept = 0;
    let gradientSlope = regularization * slope;
    let hessianIntercept = 0;
    let hessianCross = 0;
    let hessianSlope = regularization;

    observations.forEach((observation) => {
      const normalizedPred = (observation.pred - center) / scale;
      const probability = targetSigmoid(intercept + slope * normalizedPred);
      const weight = Math.max(probability * (1 - probability), 0.00001);
      const residual = probability - observation.outcome;
      gradientIntercept += residual;
      gradientSlope += residual * normalizedPred;
      hessianIntercept += weight;
      hessianCross += weight * normalizedPred;
      hessianSlope += weight * normalizedPred * normalizedPred;
    });

    const determinant = hessianIntercept * hessianSlope - hessianCross * hessianCross;
    if (!Number.isFinite(determinant) || determinant <= 0) {
      return null;
    }
    const stepIntercept = (hessianSlope * gradientIntercept - hessianCross * gradientSlope) / determinant;
    const stepSlope = (-hessianCross * gradientIntercept + hessianIntercept * gradientSlope) / determinant;
    if (!Number.isFinite(stepIntercept) || !Number.isFinite(stepSlope)) {
      return null;
    }
    intercept = Math.max(-30, Math.min(30, intercept - stepIntercept));
    slope = Math.max(-30, Math.min(30, slope - stepSlope));
    if (Math.max(Math.abs(stepIntercept), Math.abs(stepSlope)) < 0.00001) {
      break;
    }
  }

  const fittedSlope = slope;
  slope = Math.min(-0.05, slope);
  const threshold = center + (-intercept / slope) * scale;
  const bounds = targetGetModelBounds(mode, observations);
  const range = bounds.max - bounds.min;
  const predAt60 = center + (Math.log(0.6 / 0.4) - intercept) / slope * scale;
  const predAt40 = center + (Math.log(0.4 / 0.6) - intercept) / slope * scale;
  const rangeValues = [predAt60, predAt40];
  const hasValidRange = rangeValues.every(Number.isFinite);
  const rangeWidth = hasValidRange ? Math.abs(predAt40 - predAt60) : Infinity;
  if (
    !Number.isFinite(intercept)
    || !Number.isFinite(slope)
    || fittedSlope >= 0
    || !Number.isFinite(threshold)
    || range <= 0
    || !hasValidRange
    || rangeWidth >= range
    || threshold <= bounds.min
    || threshold >= bounds.max
  ) {
    return null;
  }
  return { intercept, slope, center, scale };
}

function targetApplyCalculationClearRules(observations, modelsByMode = new Map()) {
  const highestClearPredByMode = new Map();
  observations.forEach((observation) => {
    if (observation.outcome !== 1) {
      return;
    }
    const modeKey = observation.mode ?? targetPredModes.normal.key;
    const highest = highestClearPredByMode.get(modeKey);
    if (!Number.isFinite(highest) || observation.pred > highest) {
      highestClearPredByMode.set(modeKey, observation.pred);
    }
  });

  return observations.map((observation) => {
    const modeKey = observation.mode ?? targetPredModes.normal.key;
    const highestClearPred = highestClearPredByMode.get(modeKey);
    let outcome = observation.outcome;
    if (outcome === 0
      && Number.isFinite(highestClearPred)
      && observation.pred < highestClearPred - 2) {
      outcome = 1;
    }
    const model = modelsByMode.get(modeKey);
    if (outcome === 0 && model) {
      const normalizedPred = (observation.pred - model.center) / model.scale;
      const probability = targetSigmoid(model.intercept + model.slope * normalizedPred);
      if (probability >= 0.95) {
        outcome = 1;
      }
    }
    if (outcome === observation.outcome) {
      return observation;
    }
    return { ...observation, outcome, calculationOnlyClear: true };
  });
}

function targetGetPredModeNameFromKey(modeKey) {
  if (Object.prototype.hasOwnProperty.call(targetPredModes, modeKey)) return modeKey;
  const entry = Object.entries(targetPredModes)
    .find(([, definition]) => definition.key === modeKey);
  return entry?.[0] ?? "normal";
}

function targetFitPreliminaryModels(observations) {
  const grouped = new Map();
  observations.forEach((observation) => {
    const modeKey = observation.mode ?? targetPredModes.normal.key;
    const group = grouped.get(modeKey) ?? [];
    group.push(observation);
    grouped.set(modeKey, group);
  });
  const modelsByMode = new Map();
  grouped.forEach((group, modeKey) => {
    const observedChartCount = new Set(group.map(({ row }) => String(row.chart_id ?? ""))).size;
    const clearObservations = group.filter(({ outcome }) => outcome === 1);
    const notClearObservations = group.filter(({ outcome }) => outcome === 0);
    if (observedChartCount < 5 || clearObservations.length === 0 || notClearObservations.length === 0) {
      return;
    }
    const clearAverage = clearObservations.reduce((sum, { pred }) => sum + pred, 0) / clearObservations.length;
    const notClearAverage = notClearObservations.reduce((sum, { pred }) => sum + pred, 0) / notClearObservations.length;
    if (clearAverage > notClearAverage) {
      return;
    }
    const mode = targetGetPredModeNameFromKey(modeKey);
    const model = targetFitBaseModel(group, mode);
    if (model) {
      modelsByMode.set(modeKey, model);
    }
  });
  return modelsByMode;
}

function targetPreparePredObservations(mode = "normal") {
  const rawObservations = targetGetPredObservations(mode);
  const thresholdedObservations = targetApplyCalculationClearRules(rawObservations);
  const preliminaryModels = targetFitPreliminaryModels(thresholdedObservations);
  return targetApplyCalculationClearRules(rawObservations, preliminaryModels);
}

function targetSolveLinearSystem(matrix, values) {
  const size = values.length;
  const augmented = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
        pivotRow = row;
      }
    }
    if (Math.abs(augmented[pivotRow][column]) < 0.0000000001) {
      return null;
    }
    [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
    const pivot = augmented[column][column];
    for (let index = column; index <= size; index += 1) {
      augmented[column][index] /= pivot;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) {
        continue;
      }
      const factor = augmented[row][column];
      if (factor === 0) {
        continue;
      }
      for (let index = column; index <= size; index += 1) {
        augmented[row][index] -= factor * augmented[column][index];
      }
    }
  }
  return augmented.map((row) => row[size]);
}

function targetFitFeatureDeltas(observations, model) {
  const deltas = new Array(targetFeatureNames.length).fill(0);
  if (!model) {
    return deltas;
  }
  const samples = observations
    .map((observation) => ({
      pred: observation.pred,
      outcome: observation.outcome,
      vector: targetGetFeatureVector(observation.row),
    }))
    .filter((sample) => sample.vector.some((value) => value > 0));
  if (samples.length === 0) {
    return deltas;
  }

  const modelDerivativePerPred = model.slope / model.scale;
  for (let iteration = 0; iteration < targetFeatureDeltaIterations; iteration += 1) {
    const gradient = new Array(targetFeatureNames.length).fill(0);
    const hessian = Array.from(
      { length: targetFeatureNames.length },
      () => new Array(targetFeatureNames.length).fill(0),
    );

    samples.forEach((sample) => {
      const adjustment = sample.vector.reduce((total, strength, index) => total + deltas[index] * strength, 0);
      const normalizedPred = (sample.pred + adjustment - model.center) / model.scale;
      const probability = targetSigmoid(model.intercept + model.slope * normalizedPred);
      const residual = probability - sample.outcome;
      const curvature = Math.max(probability * (1 - probability), 0.00001);
      sample.vector.forEach((leftStrength, leftIndex) => {
        gradient[leftIndex] += residual * modelDerivativePerPred * leftStrength;
        sample.vector.forEach((rightStrength, rightIndex) => {
          hessian[leftIndex][rightIndex] += curvature
            * modelDerivativePerPred
            * modelDerivativePerPred
            * leftStrength
            * rightStrength;
        });
      });
    });

    for (let index = 0; index < targetFeatureNames.length; index += 1) {
      gradient[index] += 2 * targetFeatureDeltaLambda * deltas[index];
      hessian[index][index] += 2 * targetFeatureDeltaLambda;
    }

    const step = targetSolveLinearSystem(hessian, gradient);
    if (!step) {
      break;
    }
    let largestStep = 0;
    for (let index = 0; index < deltas.length; index += 1) {
      const next = deltas[index] - step[index];
      if (!Number.isFinite(next)) {
        return new Array(targetFeatureNames.length).fill(0);
      }
      deltas[index] = next;
      largestStep = Math.max(largestStep, Math.abs(step[index]));
    }
    if (largestStep < targetFeatureDeltaTolerance) {
      break;
    }
  }
  return deltas;
}
  return function(records) {
    const key = JSON.stringify([...records].map(([id, record]) => [String(id), record.status]).sort((a,b) => a[0].localeCompare(b[0])));
    if (key === lastKey) return lastResult;
    targetState.records = records;
    const observations = targetPreparePredObservations("overall");
    const model = targetFitBaseModel(observations, "overall");
    const modelsByMode = Object.fromEntries(Object.keys(targetPredModes).map(mode => [mode, targetFitBaseModel(targetPreparePredObservations(mode), mode)]));
    const deltas = targetFitFeatureDeltas(observations, model);
    const adjustedPredById = new Map(rows.map(row => [String(row.chart_id), row.calibrated_pred_skill + targetGetFeatureVector(row).reduce((sum, strength, index) => sum + strength * deltas[index], 0)]));
    lastKey = key;
    lastResult = { model, modelsByMode, deltas, adjustedPredById };
    return lastResult;
  };
};
