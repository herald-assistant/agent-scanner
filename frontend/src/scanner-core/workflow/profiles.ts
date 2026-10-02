import {CreditRate, CreditSummary, Metric, RoundObservation, RuleFinding, Truth, WorkflowRecommendation, WorkflowStream} from '../../app/models/workflow.models';
import {and, known, measured, not, or, ratio, RULES as R, spanRef, sum, test, uniqueBytes, usable} from './telemetry';
import {continuous, state} from './phases';

export function creditSummary(rounds: RoundObservation[]): CreditSummary {
  const values = rounds.map(round => known(round.credits)).filter((value): value is number => value !== undefined);
  return {known: values.length ? values.reduce((sum, value) => sum + value, 0) : null, covered: values.length, total: rounds.length};
}
export function shareAtLeast(values: Truth[], threshold: number): Truth {
  if (!values.length) return 'unknown';
  const matched = values.filter(value => value === true).length, missing = values.filter(value => value === 'unknown').length;
  return matched / values.length >= threshold ? true : (matched + missing) / values.length < threshold ? false : 'unknown';
}
export function countAtLeast(values: Truth[], threshold: number): Truth {
  const matched = values.filter(value => value === true).length, missing = values.filter(value => value === 'unknown').length;
  return matched >= threshold ? true : matched + missing < threshold ? false : 'unknown';
}
const sequences = (rounds: RoundObservation[]): RoundObservation[][] => [...new Set(rounds.map(round => round.sequence))].map(id => rounds.filter(round => round.sequence === id));
const finding = (code: string, state: Truth, rounds: RoundObservation[], version: string): RuleFinding => ({code, state, refs: rounds.map(round => round.ref), version});

export function subagentProfiles(stream: WorkflowStream, streams: WorkflowStream[], linkCoverage: boolean): RuleFinding[] {
  const rounds = stream.rounds, launch = stream.launch;
  if (!launch) return [];
  const totalInput = sum(rounds.map(round => round.input)), totalOutput = sum(rounds.map(round => round.output));
  const volume = sum([totalInput, totalOutput]);
  const outputRatio = ratio(totalOutput, totalInput, 'ΣO / ΣI');
  const descendants = streams.filter(child => child.parentId === stream.id);
  const tools = rounds.flatMap(round => round.tools);
  const results = tools.flatMap(tool => tool.result ? [tool.result] : []);
  const completeResults = rounds.length > 0 && rounds.every(round => round.toolCoverage);
  const contentMetric = (value: number | undefined, refs: string[], formula: string): Metric => value === undefined ?
    {availability: 'missing', evidenceRefs: refs, sourceAttributes: [], formula} : measured(value, refs, formula);
  const refs = [spanRef(launch.span)];
  const delegation = contentMetric(launch.arguments?.bytes, refs, 'UTF-8(arguments)');
  const returned = contentMetric(launch.result?.bytes, refs, 'UTF-8(result)');
  const resultBytes = contentMetric(completeResults ? uniqueBytes(results) : undefined, tools.map(tool => spanRef(tool.span)), 'Σ UTF-8(unique results)');
  const union = contentMetric(completeResults && launch.arguments ? uniqueBytes([launch.arguments, ...results]) : undefined,
    [...refs, ...resultBytes.evidenceRefs], 'Σ UTF-8(union(arguments, tool results))');
  const returnRatio = ratio(returned, union, 'return / source union');
  const expansion = ratio(resultBytes, delegation, 'unique results / delegation');
  const exactReturnShare = launch.result && completeResults && launch.arguments && launch.result.bytes >= R.minContent && union.value! >= R.minContent ?
    measured([launch.arguments, ...results].some(item => item.hash === launch.result!.hash) ? 1 : 0, refs, 'exact returned bytes / return') : contentMetric(undefined, refs, 'exact returned bytes / return');
  stream.flow = {delegation, results: resultBytes, returned, union, ratio: returnRatio};
  const contextGrowth = or(...sequences(rounds).map(window => and(window.length >= 2, or(
    continuous(window, 'promptLimit') && window.every(round => usable(round.pressure)) ?
      Math.max(...window.map(round => round.pressure.value!)) - window[0].pressure.value! >= .15 - 1e-12 : 'unknown',
    continuous(window, 'model') && window.every(round => usable(round.fresh)) ?
      window.slice(1).reduce((total, round) => total + round.fresh.value!, 0) >= Math.max(1024, window[0].fresh.value!) : 'unknown'
  ))));
  const checks: [string, Truth][] = [
    ['CONDENSING', and(test(union, value => value >= R.largeContent), test(returned, value => value > 0), test(returnRatio, value => value <= R.condensation))],
    ['TOOL_RESULT_EXPANSION', or(test(resultBytes, value => value >= R.largeContent), and(test(delegation, value => value >= R.minContent), test(expansion, value => value >= 4)))],
    ['PROVIDED_CONTEXT_DOMINANT', and(test(delegation, value => value >= R.largeContent), test(resultBytes, value => value < R.minContent), test(returned, value => value > 0))],
    ['PASSTHROUGH', and(test(returned, value => value >= R.minContent), test(union, value => value >= R.minContent), test(exactReturnShare, value => value >= .75))],
    ['RETURN_HEAVY', and(test(returned, value => value >= R.largeContent), test(union, value => value >= R.minContent), test(returnRatio, value => value >= .75))],
    ['CONTEXT_GROWTH', contextGrowth],
    ['OUTPUT_HEAVY', and(test(totalOutput, value => value >= 128), test(outputRatio, value => value >= R.outputRatio))],
    ['INPUT_HEAVY', and(test(totalInput, value => value >= R.minInput), test(outputRatio, value => value < R.outputRatio))],
    ['LOW_VOLUME', and(rounds.length > 0 && rounds.length <= 2, tools.length <= 1, test(volume, value => value < 4096), descendants.length ? false : linkCoverage ? true : 'unknown')]
  ];
  return checks.map(([code, state]) => ({...finding(code, state, rounds, 'subagent-profile-rules-v1'), refs: [...refs, ...rounds.map(round => round.ref), ...resultBytes.evidenceRefs]}));
}

export function sessionProfiles(streams: WorkflowStream[], linkCoverage: boolean): RuleFinding[] {
  const root = streams[0], rounds = root.rounds, allRounds = streams.flatMap(stream => stream.rounds), childCount = allRounds.length - rounds.length;
  const credits = creditSummary(allRounds), childCredits = creditSummary(streams.slice(1).flatMap(stream => stream.rounds));
  const delegation = linkCoverage ? or(allRounds.length ? childCount / allRounds.length >= .3 : 'unknown',
    credits.covered === credits.total && credits.known && childCredits.known !== null ? childCredits.known / credits.known >= .3 : 'unknown') : 'unknown';
  const growth = or(...sequences(rounds).map(window => and(window.length >= 3,
    shareAtLeast(window.map(round => round.profile === 'UNKNOWN' ? 'unknown' : round.profile === 'CONTEXT_ACCUMULATION'), .5),
    continuous(window, 'promptLimit') && window.every(round => usable(round.pressure)) ?
      Math.max(...window.map(round => round.pressure.value!)) - window[0].pressure.value! >= .2 - 1e-12 : 'unknown')));
  const iterative = and(rounds.length >= 3, shareAtLeast(rounds.map(round => state(round, 'iterativeFlow')), .5));
  const afterError = rounds.map((round, index): Truth => round.markers.includes('POST_ERROR') ? true : !index ||
    rounds[index - 1].turn.model.traceId !== round.turn.model.traceId ? false : rounds[index - 1].errorCoverage ? false : 'unknown');
  const cycleCandidates: Truth[] = [];
  for (let index = 0; index < root.segments.length; index++) {
    const segment = root.segments[index];
    if (segment.profile !== 'CONTEXT_ACCUMULATION') continue;
    const next = root.segments.slice(index + 1, index + 3).filter(item => item.rounds[0].sequence === segment.rounds[0].sequence);
    let result: Truth = 'unknown';
    for (const candidate of next) {
      if (candidate.profile === 'UNKNOWN' || candidate.profile === 'MIXED') break;
      if (candidate.profile === 'OUTPUT_DOMINANT') { result = true; break; }
      if (candidate.profile === 'CONTEXT_ACCUMULATION') { result = false; break; }
    }
    if (result === 'unknown' && next.length === 2 && next.every(item => !['UNKNOWN', 'MIXED'].includes(item.profile))) result = false;
    cycleCandidates.push(result);
  }
  const checks: [string, Truth][] = [
    ['SINGLE_PASS', and(rounds.length >= 1 && rounds.length <= 2, childCount === 0, linkCoverage ? true : 'unknown',
      ...rounds.map(round => and(round.profile === 'UNKNOWN' ? 'unknown' : round.profile !== 'CONTEXT_ACCUMULATION',
        not(state(round, 'iterativeFlow')), round.errors.length ? false : round.errorCoverage ? true : 'unknown',
        round.compactionRefs.length ? false : round.compactionCoverage ? true : 'unknown')))],
    ['PROGRESSIVE_CONTEXT_GROWTH', growth],
    ['ACCUMULATION_OUTPUT_CYCLES', countAtLeast(cycleCandidates, 2)],
    ['DELEGATION_HEAVY', delegation],
    ['ITERATIVE_TOOL_FLOW', iterative],
    ['POST_ERROR_ACTIVITY_HEAVY', and(countAtLeast(afterError, 2), shareAtLeast(afterError, .3))],
    ['COMPACTION_REHYDRATION', 'unknown']
  ];
  return checks.map(([code, state]) => finding(code, state, code === 'DELEGATION_HEAVY' ? allRounds : rounds, 'session-profile-rules-v1'));
}

export function creditRates(stream: WorkflowStream, parent?: WorkflowStream): CreditRate[] {
  const launchRound = parent?.rounds.find(round => round.ref === stream.launchRoundRef);
  const parentInteraction = parent?.rounds.filter(round => round.turn.model.traceId === launchRound?.turn.model.traceId) ?? [];
  const reference = parentInteraction.every(round => !!round.model) ? parentInteraction.filter(round => launchRound?.model && round.model === launchRound.model) : [];
  const parentRate = observedRate(reference);
  return [...new Set(stream.rounds.map(round => round.model ?? ''))].map(model => {
    const rounds = stream.rounds.filter(round => (round.model ?? '') === model), rate = observedRate(rounds);
    return {model, value: rate.value, relative: rate.comparable && parentRate.comparable && parentRate.value! > 0 ? rate.value! / parentRate.value! : null,
      cacheWriteNotModelled: rounds.some(round => test(round.cacheWrite, value => value > 0) === true),
      cacheWriteMissing: rounds.some(round => !usable(round.cacheWrite))};
  });
}
function observedRate(rounds: RoundObservation[]): {value: number | null; comparable: boolean} {
  if (!rounds.length || !rounds.every(round => round.model && [round.cache, round.fresh, round.output, round.credits].every(usable))) return {value: null, comparable: false};
  const units = rounds.reduce((sum, round) => sum + round.cache.value! + 10 * round.fresh.value! + 100 * round.output.value!, 0);
  if (units < 10_000) return {value: null, comparable: false};
  return {value: rounds.reduce((sum, round) => sum + round.credits.value!, 0) / units,
    comparable: rounds.every(round => round.cacheWrite.availability !== 'invalid' && !(known(round.cacheWrite)! > 0))};
}

export function recommendations(streams: WorkflowStream[]): WorkflowRecommendation[] {
  const findings: WorkflowRecommendation[] = [];
  for (const stream of streams) {
    for (const window of sequences(stream.rounds)) {
      const groups = new Map<string, {refs: string[]; bytes: number; roundRefs: string[]}>();
      for (const round of window) for (const tool of round.tools) {
        if (!round.orderKnown || !tool.operationKey || !tool.arguments || !tool.result) continue;
        const key = JSON.stringify([tool.operationKey, tool.arguments.hash, tool.result.hash]);
        let group = groups.get(key);
        if (!group) { group = {refs: [], bytes: 0, roundRefs: []}; groups.set(key, group); }
        group.refs.push(spanRef(tool.span)); group.roundRefs.push(round.ref); group.bytes += tool.result.bytes;
      }
      for (const group of groups.values()) if (group.refs.length >= 2) findings.push({code: 'REPEATED_IDENTICAL_TOOL_EXCHANGE', streamId: stream.id,
        refs: [...new Set([...group.roundRefs, ...group.refs])], values: [group.refs.length, group.bytes]});
    }
    // Inspect only the first later execution across the error boundary, never a convenient distant match.
    for (let index = 0; index + 1 < stream.rounds.length; index++) {
      const before = stream.rounds[index], after = stream.rounds[index + 1];
      if (!after.markers.includes('POST_ERROR')) continue;
      const failed = before.tools.filter(tool => tool.errors.length).at(-1), retry = after.tools[0];
      if (failed?.operationKey && failed.arguments && retry?.arguments && failed.operationKey === retry.operationKey && failed.arguments.hash === retry.arguments.hash) {
        findings.push({code: 'IDENTICAL_RETRY_AFTER_ERROR', streamId: stream.id, refs: [before.ref, after.ref, spanRef(failed.span), spanRef(retry.span)], values: [failed.arguments.bytes]});
      }
    }
    const launch = stream.launch;
    if (launch?.result && launch.result.bytes >= R.largeContent && stream.profiles.some(profile => profile.code === 'PASSTHROUGH' && profile.state === true)) {
      findings.push({code: 'LARGE_INLINE_HANDOFF', streamId: stream.id, refs: [stream.launchRoundRef!, spanRef(launch.span), ...stream.rounds.map(round => round.ref)], values: [launch.result.bytes]});
    }
    for (const segment of stream.segments) {
      const last = segment.rounds.at(-1)!, next = stream.rounds[stream.rounds.indexOf(last) + 1];
      if (segment.profile === 'CONTEXT_ACCUMULATION' && segment.rounds.length >= 3 && next?.sequence === last.sequence &&
          segment.rounds.filter(round => ['HIGH', 'CRITICAL'].includes(round.band)).length >= 2 && state(next, 'freshBurst') === true &&
          [...segment.rounds, next].every(round => state(round, 'outputBurst') === false)) {
        findings.push({code: 'SUSTAINED_ACCUMULATION_UNDER_PRESSURE', streamId: stream.id, refs: [...segment.rounds, next].map(round => round.ref), values: [segment.rounds.length]});
      }
    }
  }
  return findings;
}
