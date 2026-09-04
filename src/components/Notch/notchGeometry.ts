export const NOTCH_REFERENCE_WIDTH = 252
export const NOTCH_REFERENCE_HEIGHT = 31
export const DIAGRAM_SWITCH_HEIGHT = 30

export type NotchGeometry = {
  width: number
  height: number
  inset: number
  fillPath: string
  strokePath: string
}

// Draw the browser-tab shoulders in the rendered coordinate system. A fixed
// viewBox with preserveAspectRatio="none" stretches them as the cells grow;
// this keeps the 28px flare intact at every width.
export function getNotchGeometry(measuredWidth: number, height = DIAGRAM_SWITCH_HEIGHT): NotchGeometry {
  const width = Math.max(measuredWidth, NOTCH_REFERENCE_WIDTH * height / NOTCH_REFERENCE_HEIGHT)
  const flare = Math.round((height * 28 / 30) / 4) * 4
  const topHandle = flare * 0.30
  const bottomHandle = flare * 0.55
  const baseline = height - 0.5
  const spine = [
    'M 0 0',
    `C ${topHandle} 0, ${flare - bottomHandle} ${baseline}, ${flare} ${baseline}`,
    `H ${width - flare}`,
    `C ${width - flare + bottomHandle} ${baseline}, ${width - topHandle} 0, ${width} 0`,
  ].join(' ')

  return {
    width,
    height,
    inset: Math.round((flare + 8) / 4) * 4,
    fillPath: `${spine} Z`,
    strokePath: spine,
  }
}
