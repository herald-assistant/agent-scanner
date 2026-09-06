import {Metric, PhaseSegment, Predicate, Profile, RoundObservation, Truth} from '../../models/workflow.models';
import {and, derived, known, median, or, RULES as R, test, usable} from './telemetry';

export const PROFILES: Profile[] = ['CONTEXT_ACCUMULATION', 'CONTEXT_PROCESSING', 'OUTPUT_DOMINANT'];
export const state = (round: RoundObservation, code: string): Truth => round.predicates.find(predicate => predicate.code === code)?.state ?? 'unknown';
export function continuous(rounds: RoundObservation[], field: 'model' | 'promptLimit' | 'outputLimit'): boolean {
  if (!rounds.length) return false;
  const values = rounds.map(round => field === 'model' ? round.model : known(round[field]));
  return values.every(value => value !== undefined && value === values[0]);
}
export function classifyRounds(rounds: RoundObservation[]): PhaseSegment[] {
  let sequence = 0;
  const lastKnown = new Map<string, string | number>();
  for (let index = 0; index < rounds.length; index++) {
    const round = rounds[index], previous = rounds[index - 1];
    const sameTrace = previous?.turn.model.traceId === round.turn.model.traceId;
    if (!sameTrace) lastKnown.clear();
    let explicitChange = false;
    for (const field of ['model', 'promptLimit', 'outputLimit'] as const) {
      const value = field === 'model' ? round.model : known(round[field]);
      if (value !== undefined) {
        if (lastKnown.has(field) && lastKnown.get(field) !== value) {
          explicitChange = true;
          const marker = field === 'model' ? 'MODEL_CHANGE' : 'LIMIT_CHANGE';
          if (!round.markers.includes(marker)) round.markers.push(marker);
        }
        lastKnown.set(field, value);
      }
    }
    const baseCompatible = sameTrace && round.orderKnown && previous.orderKnown && !explicitChange;
    if (baseCompatible && previous.errors.length) round.markers.push('POST_ERROR');
    const boundary = !baseCompatible || previous.errors.length > 0 || previous.compactionRefs.length > 0 || round.compactionRefs.length > 0;
    if (boundary) sequence++;
    round.sequence = `${round.streamId}/${round.turn.model.traceId}/${sequence}`;
    if (!boundary && continuous([previous, round], 'promptLimit') && continuous([previous, round], 'model')) {
      const p = known(previous.pressure), c = known(round.pressure);
      round.deltaPressure = derived(p !== undefined && c !== undefined ? c - p : undefined, [previous.pressure, round.pressure], 'pressure(t) − pressure(t−1)');
    }
  }
  const sequences = [...new Set(rounds.map(round => round.sequence))].map(id => rounds.filter(round => round.sequence === id));
  for (const window of sequences) {
    const iterative = iterativeFlow(window);
    for (let index = 0; index < window.length; index++) {
      const round = window[index], previous = window[index - 1], next = window[index + 1];
      const history = window.slice(0, index);
      const freshBurst = burst(round, history, 'fresh'), outputBurst = burst(round, history, 'output');
      const unique: Truth = round.toolCoverage ? round.uniqueResultBytes.value! >= R.minContent || round.distinctResults >= 2 : 'unknown';
      const low: Truth = round.toolCoverage ? round.uniqueResultBytes.value! < R.minContent && round.distinctResults <= 1 : 'unknown';
      const nonTrivial = test(round.output, value => value >= R.minOutput);
      const stable = test(round.deltaPressure, value => Math.abs(value) <= R.stableDelta + 1e-12);
      const highRatio = ratioTest(round.output, round.input, R.outputRatio);
      const nextGrowth = next ? test(next.deltaPressure, value => value >= R.pressureGrowth - 1e-12) : 'unknown';
      const nextBurst = next ? burst(next, window.slice(0, index + 1), 'fresh') : 'unknown';
      const predicates: Predicate[] = [
        {code: 'uniqueResultSignal', state: unique, weights: [35, -20, -20], refs: round.uniqueResultBytes.evidenceRefs},
        {code: 'pressureGrowthNext', state: nextGrowth, weights: [30, -20, -10], refs: next?.deltaPressure.evidenceRefs ?? [round.ref]},
        {code: 'freshBurstNext', state: nextBurst, weights: [25, -15, -10], refs: next ? [next.ref, ...history.map(item => item.ref), round.ref] : [round.ref]},
        {code: 'pressureStable', state: stable, weights: [0, 25, 10], refs: round.deltaPressure.evidenceRefs},
        {code: 'lowResultSignal', state: low, weights: [-15, 25, 20], refs: [round.ref, ...round.resultBytes.evidenceRefs]},
        {code: 'nonTrivialOutput', state: nonTrivial, weights: [0, 20, 10], refs: [round.ref]},
        {code: 'outputBurst', state: outputBurst, weights: [-10, 0, 40], refs: [round.ref, ...history.map(item => item.ref)]},
        {code: 'highOutputRatio', state: highRatio, weights: [-10, 0, 25], refs: [round.ref]},
        {code: 'highDuplicateRatio', state: test(round.duplicateRatio, value => value >= R.duplicateRatio), weights: [-20, 0, 0], refs: round.resultBytes.evidenceRefs},
        {code: 'validInputOutput', state: and(test(round.input, value => value >= R.minInput), test(round.output, () => true)), weights: [0, 10, 0], refs: [round.ref]},
        {code: 'freshBurst', state: freshBurst, weights: [0, 0, 0], refs: [round.ref, ...history.map(item => item.ref)]},
        {code: 'iterativeFlow', state: iterative, weights: [0, 0, 0], refs: window.map(item => item.ref)}
      ];
      round.predicates = predicates;
      round.provisional = !next;
      round.scores = PROFILES.map((_, p) => predicates.reduce((sum, predicate) => sum + (predicate.state === true ? predicate.weights[p] : 0), 0));
      const adjust = (code: string, points: number[], refs: string[]) => {
        round.adjustments.push({code, points, refs});
        round.scores = round.scores.map((score, index) => score + points[index]);
      };
      if (round.band !== 'UNKNOWN' && or(freshBurst, unique) === true) adjust('contextModifier', [5, 0, 0], [round.ref]);
      if (and(stable, or(low, nonTrivial)) === true) adjust('stableProcessingModifier', [0, 5, 0], round.deltaPressure.evidenceRefs);
      if (and(or(stable, ['HIGH', 'CRITICAL'].includes(round.band)), outputBurst) === true) adjust('outputModifier', [0, 0, 5], [round.ref]);
      if (previous && ['model', 'promptLimit', 'outputLimit'].every(field => continuous([previous, round], field as 'model' | 'promptLimit' | 'outputLimit'))) {
        if (previous.profile === 'CONTEXT_ACCUMULATION') adjust('transitionPrior', [0, 10, 10], [previous.ref, round.ref]);
        if (previous.profile === 'CONTEXT_PROCESSING') adjust('transitionPrior', [0, 0, 10], [previous.ref, round.ref]);
        if (previous.profile === 'OUTPUT_DOMINANT' && or(freshBurst, unique) === true) adjust('transitionPrior', [5, 0, 0], [previous.ref, round.ref]);
      }
      const eligible = PROFILES.map((_, p) => predicates.some(predicate => predicate.code !== 'validInputOutput' && predicate.state === true && predicate.weights[p] > 0));
      const highest = Math.max(...round.scores.filter((_, p) => eligible[p]));
      round.candidates = PROFILES.filter((_, p) => eligible[p] && round.scores[p] >= R.threshold && highest - round.scores[p] <= R.mixedMargin);
      round.profile = round.candidates.length > 1 ? 'MIXED' : round.candidates[0] ?? 'UNKNOWN';
      const coverages = PROFILES.map((_, p) => {
        const total = predicates.reduce((sum, item) => sum + Math.abs(item.weights[p]), 0);
        return predicates.reduce((sum, item) => sum + (item.state === 'unknown' ? 0 : Math.abs(item.weights[p])), 0) / total;
      });
      const candidateIndexes = round.candidates.map(profile => PROFILES.indexOf(profile));
      round.coverage = candidateIndexes.length ? Math.min(...candidateIndexes.map(p => coverages[p])) : Math.min(...coverages);
      if (round.profile !== 'UNKNOWN') {
        const minimumScore = Math.min(...candidateIndexes.map(p => round.scores[p]));
        const margin = [...round.scores].sort((a, b) => b - a)[0] - [...round.scores].sort((a, b) => b - a)[1];
        round.confidence = !round.provisional && minimumScore >= 75 && round.coverage >= .75 && (round.profile === 'MIXED' || margin >= 20) ? 'high' :
          !round.provisional && minimumScore >= 60 && round.coverage >= .6 && (round.profile === 'MIXED' || margin > R.mixedMargin) ? 'medium' : 'low';
      }
      if (iterative === true) round.qualifiers.push('ITERATIVE_FLOW');
      if (round.turn.interactionTurnIndex === 1) {
        const later = rounds.filter(item => item.turn.model.traceId === round.turn.model.traceId && item !== round).map(item => known(item.input)).filter((value): value is number => value !== undefined);
        if (or(test(round.pressure, value => value >= R.initialPressure), and(test(round.input, value => value >= R.initialInput),
            later.length >= 2 ? test(round.input, value => value >= 2 * median(later)) : 'unknown')) === true) round.markers.push('INITIAL_LARGE_CONTEXT');
      }
    }
  }
  const segments: PhaseSegment[] = [];
  for (const round of rounds) {
    const last = segments.at(-1);
    if (last && round.orderKnown && last.profile === round.profile && last.rounds.at(-1)!.sequence === round.sequence) last.rounds.push(round);
    else segments.push({id: round.ref, profile: round.profile, rounds: [round]});
  }
  return segments;
}

function ratioTest(numerator: Metric, denominator: Metric, threshold: number): Truth {
  const a = known(numerator), b = known(denominator);
  return a === undefined || b === undefined || b <= 0 ? 'unknown' : a / b >= threshold;
}
function burst(round: RoundObservation, history: RoundObservation[], field: 'fresh' | 'output'): Truth {
  const value = known(round[field]);
  if (value === undefined) return 'unknown';
  if (value < (field === 'fresh' ? R.minInput : R.minOutput)) return false;
  const positive = history.map(item => known(item[field])).filter((item): item is number => item !== undefined && item > 0);
  const historical: Truth = positive.length >= 2 && continuous([...history, round], 'model') ? value >= R.burstFactor * median(positive) : 'unknown';
  return field === 'output' ? historical : or(historical, test(round.promptLimit, limit => value / limit >= R.pressureGrowth));
}
function iterativeFlow(rounds: RoundObservation[]): Truth {
  if (rounds.length < R.iterativeRounds || rounds.filter(round => round.tools.length > 0).length < 2) return false;
  if (!continuous(rounds, 'model') || !rounds.every(round => usable(round.input) && usable(round.output) && round.orderKnown)) return 'unknown';
  const volume = rounds.reduce((sum, round) => sum + round.input.value! + round.output.value!, 0);
  const mean = rounds.reduce((sum, round) => sum + round.input.value!, 0) / rounds.length;
  if (!volume || !mean) return 'unknown';
  const cv = Math.sqrt(rounds.reduce((sum, round) => sum + (round.input.value! - mean) ** 2, 0) / rounds.length) / mean;
  return rounds.every(round => (round.input.value! + round.output.value!) / volume <= R.roundShare) && cv <= R.inputCv;
}
