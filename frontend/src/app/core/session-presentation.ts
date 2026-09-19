import {Session} from '../models/scanner.models';

export function sessionRepositoryName(session: Session): string | undefined {
  if (!session.repository) return undefined;
  const name = session.repository.replace(/\/$/, '').split('/').pop() || session.repository;
  return name.replace(/\.git$/i, '');
}

export function sessionSourceLabel(session: Session): string {
  if (session.sourceKind === 'vscode') return 'VS Code';
  if (session.sourceKind === 'copilot-sdk') return 'Copilot SDK';
  return session.sourceName && session.sourceName !== 'Źródło nierozpoznane' ? session.sourceName : 'Źródło nierozpoznane';
}

export function sessionEmitterLabel(session: Session): string | undefined {
  const service = session.sourceService === 'copilot-chat' ? 'Copilot Chat'
    : session.sourceService === 'github-copilot' ? 'GitHub Copilot SDK'
      : session.sourceService;
  return service ? `${service}${session.sourceVersion ? ` ${session.sourceVersion}` : ''}` : undefined;
}

export function sessionSourceIcon(session: Session): string {
  if (session.sourceKind === 'vscode') return 'code';
  if (session.sourceKind === 'copilot-sdk') return 'sdk';
  return 'smart_toy';
}

export function sessionHeading(session: Session): string {
  if (session.sourceKind === 'vscode') return 'GitHub Copilot w VS Code';
  if (session.sourceKind === 'copilot-sdk') return 'GitHub Copilot SDK';
  return 'Rozmowa z GitHub Copilot';
}
