import type { PlayerTopUmaSummary } from '@umalytics/shared';
import { isHashedUmaAssetUrl } from '../../umas/umaPortraits';
import { UmaImage, getFallbackUmaImageUrl } from '../common/UmaImage';

export function BestUmaPortrait({ uma }: { uma: PlayerTopUmaSummary }) {
  const fallbackImageUrl = getFallbackUmaImageUrl(uma.umaId);
  const imageUrl = isHashedUmaAssetUrl(uma.imageUrl)
    ? fallbackImageUrl
    : uma.imageUrl ?? fallbackImageUrl;

  return (
    <span className="best-uma-portrait" aria-hidden="true">
      <UmaImage imageUrl={imageUrl} name={uma.name} />
    </span>
  );
}
