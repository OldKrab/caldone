export type CameraLens = { id: string; scale: number; min: number; max: number; primary: boolean };

/** Android adapter returns relative optical scale and the actual CameraX zoom range.
 * Ignore unknown capability data instead of promising a lens the phone cannot expose. */
export function parseCameraLenses(values: string[]): CameraLens[] {
  return values.flatMap(value => {
    try {
      const lens = JSON.parse(value) as CameraLens;
      return typeof lens.id === 'string' && [lens.scale, lens.min, lens.max].every(n => Number.isFinite(n) && n > 0) && lens.max >= lens.min ? [lens] : [];
    } catch { return []; }
  });
}
export function zoomRange(lenses: CameraLens[]): [number, number] {
  return lenses.length ? [Math.min(...lenses.map(lens => lens.scale * lens.min)), Math.min(8, Math.max(...lenses.map(lens => lens.scale * lens.max)))] : [1, 1];
}
export function zoomStops(lenses: CameraLens[]): number[] {
  if (!lenses.length) return [];
  const [min, max] = zoomRange(lenses);
  return [...new Set([...(min < 0.95 ? [Math.round(min * 10) / 10] : []), 1, ...(max >= 2 ? [2] : [])])];
}
export function chooseZoom(lenses: CameraLens[], requested: number): { id: string; zoom: number; factor: number } | undefined {
  if (!lenses.length) return undefined;
  const [min, max] = zoomRange(lenses);
  const target = Math.max(min, Math.min(max, requested));
  const candidates = lenses.filter(lens => target >= lens.scale * lens.min && target <= lens.scale * lens.max);
  // Prefer the main camera at normal magnification; use the closest optical
  // field of view otherwise to avoid needless digital enlargement.
  const lens = candidates.sort((a,b) => Number(b.primary && target >= 1) - Number(a.primary && target >= 1) || b.scale - a.scale)[0];
  if (!lens) return undefined;
  return { id: lens.id, zoom: target / lens.scale / lens.max, factor: target };
}
