// Shared "visual preview unavailable" content for card covers, thumbnails,
// and media wells across the Design Library, templates gallery, and
// storyboard shot frames (t11: images always load). Standardizes the quiet
// glyph + label pattern seeded by DesignLibrarySection so an image load
// failure or a missing src never renders a broken-image glyph or an empty
// collapse — callers keep their own sized/positioned wrapper (the fallback
// still fills the same cover slot) and drop this in for the content.
import { Icon } from './Icon';

interface Props {
  label?: string;
  size?: number;
}

export function MediaFallback({ label = 'Visual preview unavailable', size = 28 }: Props) {
  return (
    <>
      <Icon name="image" size={size} />
      <span>{label}</span>
    </>
  );
}
