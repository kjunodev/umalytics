import { useState } from 'react';
import type { EsportsTeamIcon } from '@umalytics/shared';
import { TeamIcon } from '@umalytics/ui/common/TeamIcon';

function LoadedTeamIcon({ icon }: { icon: EsportsTeamIcon }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <span className="desktop-team-icon" onErrorCapture={() => setFailed(true)}><TeamIcon icon={icon}/></span>;
}
export function DesktopTeamIcon({ icon }: { icon?: EsportsTeamIcon }) {
  if (!icon || typeof icon.logoUrl !== 'string' || !/^https:\/\//.test(icon.logoUrl)) return null;
  return <LoadedTeamIcon key={icon.logoUrl} icon={icon}/>;
}
