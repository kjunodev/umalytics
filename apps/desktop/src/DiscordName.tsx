import { useId, useRef } from 'react';
import { positionTeamIconTooltip } from '@umalytics/ui/common/tooltipPlacement';

export function discordNameLabel(name: string, username?: string): string {
  return username?.trim() && username.trim() !== name ? `${name} (Discord: ${username.trim()})` : name;
}

export function DiscordName({ name, username, onClick }: { name: string; username?: string; onClick?: () => void }) {
  const anchor = useRef<HTMLSpanElement>(null), tooltip = useRef<HTMLSpanElement>(null);
  const id = useId();
  const show = !!username?.trim() && username.trim() !== name;
  const place = () => { if (anchor.current && tooltip.current) positionTeamIconTooltip(anchor.current, tooltip.current); };
  return <span ref={anchor} className="discord-name" onMouseEnter={place} onFocus={place} onClick={onClick}
    tabIndex={show && !onClick ? 0 : undefined} aria-describedby={show ? id : undefined}>
    {name}{show && <span ref={tooltip} id={id} role="tooltip" className="discord-name-tooltip">Discord: {username!.trim()}</span>}
  </span>;
}
