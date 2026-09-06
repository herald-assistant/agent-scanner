import {RoundCategory, ToolCategory, ToolFit, ToolSpecialization} from '../../models/tool-classification.models';

export const CATEGORIES: Record<ToolCategory | 'MIXED' | 'UNMAPPED' | 'MODEL', {label: string; short: string; icon: string}> = {
  DATA_ACCESS: {label: 'Pozyskiwanie danych', short: 'Dane', icon: 'travel_explore'},
  ANALYSIS: {label: 'Analiza struktury', short: 'Analiza', icon: 'account_tree'},
  MODIFICATION: {label: 'Tworzenie i edycja', short: 'Edycja', icon: 'edit_note'},
  VALIDATION: {label: 'Weryfikacja', short: 'Weryfikacja', icon: 'fact_check'},
  EXECUTION: {label: 'Wykonywanie poleceń', short: 'Polecenia', icon: 'terminal'},
  EXTERNAL: {label: 'Dane zewnętrzne', short: 'Dane', icon: 'public'},
  COORDINATION: {label: 'Koordynacja', short: 'Delegacja / plan', icon: 'alt_route'},
  DELEGATION: {label: 'Delegacja do subagenta', short: 'Delegacja', icon: 'call_split'},
  OTHER: {label: 'Inna lub nieokreślona funkcja', short: 'Inne', icon: 'more_horiz'},
  MIXED: {label: 'Różne funkcje narzędzi', short: 'Różne funkcje', icon: 'hub'},
  UNMAPPED: {label: 'Brak mapowania narzędzi', short: 'Brak definicji', icon: 'question_mark'},
  MODEL: {label: 'Żądanie modelu', short: 'Model', icon: 'chat_bubble_outline'}
};
export const SPECIALIZATIONS: Record<ToolSpecialization, string> = {GENERAL_PURPOSE: 'Uniwersalne', DOMAIN_SPECIFIC: 'Domenowe', TASK_SPECIFIC: 'Dedykowane zadaniu', UNKNOWN: 'Specjalizacja nieustalona'};
export const FITS: Record<ToolFit, string> = {DIRECT: 'Bezpośrednio do celu', SUPPORTING: 'Pomocnicze', WEAK: 'Słaby widoczny związek', UNKNOWN: 'Brak podstaw do oceny'};
export const ROUND_CATEGORIES: Record<RoundCategory | 'UNMAPPED', {label: string; icon: string}> = {
  ACQUIRE_DATA: {label: 'Pozyskanie danych', icon: 'travel_explore'},
  MODIFY: {label: 'Zmiana lub zapis', icon: 'edit_note'},
  WRITE_INTERMEDIATE: {label: 'Zapis wyniku pośredniego', icon: 'draft'},
  WRITE_FINAL: {label: 'Zapis artefaktu końcowego', icon: 'save'},
  VALIDATE: {label: 'Weryfikacja', icon: 'fact_check'},
  DELEGATE: {label: 'Żądanie delegacji', icon: 'call_split'},
  MANAGE_CONTEXT: {label: 'Zarządzanie kontekstem', icon: 'compress'},
  RESPOND: {label: 'Odpowiedź lub komunikat', icon: 'chat_bubble_outline'},
  OTHER: {label: 'Inna akcja', icon: 'more_horiz'},
  MIXED: {label: 'Kilka żądanych akcji', icon: 'hub'},
  UNKNOWN: {label: 'Akcja nieustalona', icon: 'question_mark'},
  UNMAPPED: {label: 'Brak kategorii', icon: 'question_mark'}
};
