export interface PreviewFit {
  scale: number;
  width: number;
  height: number;
}

const STAGE_GUTTER = 32;

export function calculatePreviewFit(
  stageWidth: number,
  stageHeight: number,
  contentWidth: number,
  contentHeight: number,
): PreviewFit {
  if (stageWidth <= 0 || stageHeight <= 0 || contentWidth <= 0 || contentHeight <= 0) {
    return { scale: 1, width: contentWidth, height: contentHeight };
  }

  const scale = Math.min(
    Math.max(1, stageWidth - STAGE_GUTTER) / contentWidth,
    Math.max(1, stageHeight - STAGE_GUTTER) / contentHeight,
  );

  return {
    scale,
    width: contentWidth * scale,
    height: contentHeight * scale,
  };
}
