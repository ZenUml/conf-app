import { describe, it, expect } from 'vitest';
import { computeUpscaleDpi, withDpiDirective, readPngSize, TARGET_WIDTH_PX, MAX_DIMENSION_PX } from './resolution';

/** Build a minimal (header-only, not a decodable image) PNG buffer for IHDR parsing tests. */
function buildFakePng(width: number, height: number): Blob {
  const bytes = new Uint8Array(24);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  bytes.set(sig, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false); // IHDR chunk length
  bytes.set([73, 72, 68, 82], 12); // 'IHDR'
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return new Blob([bytes], { type: 'image/png' });
}

describe('computeUpscaleDpi', () => {
  it('returns a dpi that scales a tiny diagram up to the target width', () => {
    // Empirically observed sample: 95x129 (measured from a real staging export).
    const dpi = computeUpscaleDpi(95, 129);
    expect(dpi).not.toBeNull();
    expect(dpi!).toBeGreaterThan(96);
    // Predicted resulting width should land at/above target (linear scaling).
    const predictedWidth = 95 * (dpi! / 96);
    expect(predictedWidth).toBeGreaterThanOrEqual(TARGET_WIDTH_PX - 1);
  });

  it('returns null when the diagram is already at/above target width', () => {
    expect(computeUpscaleDpi(1500, 400)).toBeNull();
    expect(computeUpscaleDpi(TARGET_WIDTH_PX, 400)).toBeNull();
  });

  it('returns null for zero/invalid dimensions', () => {
    expect(computeUpscaleDpi(0, 100)).toBeNull();
    expect(computeUpscaleDpi(-5, 100)).toBeNull();
  });

  it('caps the dpi so a narrow-but-very-tall diagram does not blow past MAX_DIMENSION_PX', () => {
    // Width 50 needs a huge scale to hit 1400 wide, but height 3000 would
    // explode well past MAX_DIMENSION_PX at that scale — height must win.
    const dpi = computeUpscaleDpi(50, 3000);
    expect(dpi).not.toBeNull();
    const predictedHeight = 3000 * (dpi! / 96);
    expect(predictedHeight).toBeLessThanOrEqual(MAX_DIMENSION_PX + 1);
  });

  it('caps the dpi so a wide-but-short diagram does not blow width past MAX_DIMENSION_PX', () => {
    const dpi = computeUpscaleDpi(10, 40);
    expect(dpi).not.toBeNull();
    const predictedWidth = 10 * (dpi! / 96);
    expect(predictedWidth).toBeLessThanOrEqual(MAX_DIMENSION_PX + 1);
  });
});

describe('withDpiDirective', () => {
  it('inserts skinparam dpi right after a bare @startuml line', () => {
    const source = '@startuml\nAlice -> Bob: Hi\n@enduml';
    const result = withDpiDirective(source, 600);
    expect(result).toBe('@startuml\nskinparam dpi 600\nAlice -> Bob: Hi\n@enduml');
  });

  it('inserts skinparam dpi after a titled @startuml line', () => {
    const source = '@startuml MyDiagram\nAlice -> Bob: Hi\n@enduml';
    const result = withDpiDirective(source, 600);
    expect(result).toBe('@startuml MyDiagram\nskinparam dpi 600\nAlice -> Bob: Hi\n@enduml');
  });

  it('leaves content unchanged when it does not start with @startuml', () => {
    const source = 'not a plantuml diagram';
    expect(withDpiDirective(source, 600)).toBe(source);
  });
});

describe('readPngSize', () => {
  it('reads width/height from a well-formed PNG IHDR chunk', async () => {
    const blob = buildFakePng(95, 129);
    await expect(readPngSize(blob)).resolves.toEqual({ width: 95, height: 129 });
  });

  it('returns null for a blob that is too short to be a PNG', async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    await expect(readPngSize(blob)).resolves.toBeNull();
  });

  it('returns null for a blob with the wrong signature', async () => {
    const bytes = new Uint8Array(24);
    bytes.set([0, 0, 0, 0, 0, 0, 0, 0], 0);
    bytes.set([73, 72, 68, 82], 12);
    const blob = new Blob([bytes], { type: 'image/png' });
    await expect(readPngSize(blob)).resolves.toBeNull();
  });
});
