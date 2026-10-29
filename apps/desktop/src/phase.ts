export function phaseLabel(phase?: string): string {
  const labels: Record<string, string> = { lobby: 'Waiting for draft', 'uma-pick': 'Uma picks', 'uma-ban': 'Uma bans', 'uma-veto': 'Uma vetoes', 'map-pick': 'Race picks', 'map-ban': 'Race bans', complete: 'Draft complete' };
  if (!phase) return 'Live room';
  return labels[phase] ?? phase.replaceAll('-', ' ').replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
}
