import {ModelTurn, SessionDetail, SpanRecord} from './scanner.models';

export type Availability = 'emitted' | 'derived' | 'missing' | 'invalid' | 'ambiguous';
export type Truth = true | false | 'unknown';
export type Profile = 'CONTEXT_ACCUMULATION' | 'CONTEXT_PROCESSING' | 'OUTPUT_DOMINANT' | 'MIXED' | 'UNKNOWN';
export type ContextBand = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';
export interface Metric {
  value?: number;
  availability: Availability;
  sourceAttributes: string[];
  evidenceRefs: string[];
  formula?: string;
}
export interface ContentElement { hash: string; bytes: number; ref: string; }
export interface ToolObservation {
  span: SpanRecord;
  callId?: string;
  operationKey?: string;
  arguments?: ContentElement;
  result?: ContentElement;
  errors: string[];
}
export interface Predicate {
  code: string;
  state: Truth;
  refs: string[];
  weights: readonly [number, number, number];
}
export interface RoundObservation {
  ref: string;
  streamId: string;
  turn: ModelTurn;
  sequence: string;
  orderKnown: boolean;
  model?: string;
  input: Metric;
  cache: Metric;
  fresh: Metric;
  output: Metric;
  cacheWrite: Metric;
  credits: Metric;
  promptLimit: Metric;
  outputLimit: Metric;
  pressure: Metric;
  occupancy: Metric;
  deltaPressure: Metric;
  band: ContextBand;
  tools: ToolObservation[];
  toolCoverage: boolean;
  resultBytes: Metric;
  uniqueResultBytes: Metric;
  duplicateRatio: Metric;
  distinctResults: number;
  errors: {ref: string; codes: string[]}[];
  errorCoverage: boolean;
  compactionCoverage: boolean;
  compactionRefs: string[];
  markers: string[];
  qualifiers: string[];
  predicates: Predicate[];
  profile: Profile;
  candidates: Profile[];
  scores: number[];
  adjustments: {code: string; points: number[]; refs: string[]}[];
  coverage: number;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  provisional: boolean;
}
export interface PhaseSegment { id: string; profile: Profile; rounds: RoundObservation[]; }
export interface RuleFinding {
  code: string;
  state: Truth;
  refs: string[];
  version: string;
}
export interface CreditSummary { known: number | null; covered: number; total: number; }
export interface CreditRate {
  model: string;
  value: number | null;
  relative: number | null;
  cacheWriteNotModelled: boolean;
  cacheWriteMissing: boolean;
}
export interface WorkflowStream {
  id: string;
  sessionId: number;
  label: string;
  source: SessionDetail;
  parentId?: string;
  launch?: ToolObservation;
  launchRoundRef?: string;
  depth: number;
  rounds: RoundObservation[];
  segments: PhaseSegment[];
  profiles: RuleFinding[];
  credits: CreditSummary;
  subtreeCredits: CreditSummary;
  rates: CreditRate[];
  flow?: {delegation: Metric; results: Metric; returned: Metric; union: Metric; ratio: Metric};
}
export interface LinkIssue { state: 'ambiguous' | 'invalidCycle' | 'unlinked'; refs: string[]; candidateIds: string[]; }
export interface WorkflowRecommendation { code: string; refs: string[]; streamId: string; values: number[]; }
export interface WorkflowAnalysis {
  source: SessionDetail;
  classifierVersion: string;
  componentVersions: Record<string, string>;
  cutoffSignalId: number;
  streams: WorkflowStream[];
  linkIssues: LinkIssue[];
  linkCoverage: boolean;
  treeCredits: CreditSummary;
  profiles: RuleFinding[];
  recommendations: WorkflowRecommendation[];
  upstreamCompleteness: 'unverified' | 'truncated';
}
