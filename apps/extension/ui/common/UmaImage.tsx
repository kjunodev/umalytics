import { useEffect, useState } from 'react';
import { getUmaPortraitUrl } from '../../umas/umaPortraits';

export function UmaImage({
  imageUrl,
  name,
  loading = 'lazy'
}: {
  imageUrl: string | undefined;
  name: string;
  loading?: 'eager' | 'lazy';
}) {
  const [hasImageError, setHasImageError] = useState(false);
  const shouldShowImage = imageUrl !== undefined && !hasImageError;

  useEffect(() => {
    setHasImageError(false);
  }, [imageUrl]);

  return shouldShowImage ? (
    <img
      src={imageUrl}
      alt=""
      loading={loading}
      onError={() => {
        setHasImageError(true);
      }}
    />
  ) : (
    <span>{getUmaInitials(name)}</span>
  );
}

export function getFallbackUmaImageUrl(umaId: string): string | undefined {
  return getUmaPortraitUrl(umaId);
}

export function getUmaInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
