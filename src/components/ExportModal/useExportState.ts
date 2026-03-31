import { reactive, computed, ref, type Ref } from 'vue';

export interface Point {
  x: number;
  y: number;
}

export interface ArrowPoints {
  start: Point;
  end: Point;
}

export interface NoteState {
  text: string;
  position: string;
  fontSize: number;
  color: string;
}

export interface ArrowState {
  enabled: boolean;
  type: string;
  label: string;
  color: string;
  thickness: number;
}

export interface WatermarkState {
  enabled: boolean;
  text: string;
  opacity: number;
  fontSize: number;
  color: string;
  position: 'diagonal' | 'bottom-right';
}

export interface ThemeOption {
  value: string;
  label: string;
  style: Record<string, string>;
}

export interface BackgroundOption {
  value: string;
  label: string;
  color: string;
}

export type ArrowInteractionState = 'idle' | 'creating' | 'placed';

export interface CalloutState {
  enabled: boolean;
  text: string;
  fontSize: number;
  color: string;
  bgColor: string;
  position: Point | null;
  tipPosition: Point | null;
}

export interface ExportState {
  theme: Ref<string>;
  background: Ref<string>;
  customBgColor: Ref<string>;
  note: NoteState;
  arrow: ArrowState;
  watermark: WatermarkState;
  callout: CalloutState;
  arrowPoints: Ref<ArrowPoints | null>;
  arrowClickCount: Ref<number>;
  arrowInteraction: Ref<ArrowInteractionState>;
  notePoint: Ref<Point | null>;
  notePlaceMode: Ref<boolean>;
  noteDragging: Ref<boolean>;
  noteEditing: Ref<boolean>;
  calloutPlaceMode: Ref<boolean>;
  previewDataUrl: Ref<string | null>;
  isCapturing: Ref<boolean>;
  isExporting: Ref<boolean>;
  selectedAnnotation: Ref<'note' | 'arrow' | 'watermark' | 'callout' | null>;

  themes: ThemeOption[];
  backgrounds: BackgroundOption[];

  resolvedBgColor: ReturnType<typeof computed<string>>;
  previewCanvasStyle: ReturnType<typeof computed<Record<string, string>>>;

  selectBackground: (value: string) => void;
  resetArrow: () => void;
}

export function useExportState(): ExportState {
  const theme = ref('auto');
  const background = ref('white');
  const customBgColor = ref('#ffffff');
  const previewDataUrl = ref<string | null>(null);
  const isCapturing = ref(false);
  const isExporting = ref(false);
  const arrowPoints = ref<ArrowPoints | null>(null);
  const arrowClickCount = ref(0);
  const arrowInteraction = ref<ArrowInteractionState>('idle');
  const notePoint = ref<Point | null>(null);
  const notePlaceMode = ref(false);
  const noteDragging = ref(false);
  const noteEditing = ref(false);
  const calloutPlaceMode = ref(false);
  const selectedAnnotation = ref<'note' | 'arrow' | 'watermark' | 'callout' | null>(null);

  const note: NoteState = reactive({
    text: '',
    position: 'bottom-center',
    fontSize: 14,
    color: '#374151',
  });

  const arrow: ArrowState = reactive({
    enabled: false,
    type: '→',
    label: '',
    color: '#ef4444',
    thickness: 2,
  });

  const watermark: WatermarkState = reactive({
    enabled: false,
    text: 'Confidential',
    opacity: 20,
    fontSize: 24,
    color: '#9ca3af',
    position: 'diagonal',
  });

  const callout: CalloutState = reactive({
    enabled: false,
    text: '',
    fontSize: 14,
    color: '#1e293b',
    bgColor: '#fffde7',
    position: null,
    tipPosition: null,
  });

  const themes: ThemeOption[] = [
    { value: 'auto', label: 'Auto', style: { background: 'linear-gradient(135deg, #ffffff 50%, #1e293b 50%)', border: '1px solid #334155' } },
    { value: 'light', label: 'Light', style: { backgroundColor: '#ffffff', border: '1px solid #e2e8f0' } },
    { value: 'dark', label: 'Dark', style: { backgroundColor: '#1e293b', border: '1px solid #334155' } },
    { value: 'blueprint', label: 'Blueprint', style: { backgroundColor: '#0f172a', border: '1px solid #1e3a5f' } },
  ];

  const backgrounds: BackgroundOption[] = [
    { value: 'transparent', label: 'Transparent', color: '' },
    { value: 'white', label: 'White', color: '#ffffff' },
    { value: 'warm', label: 'Warm', color: '#fffbf0' },
    { value: 'cool', label: 'Cool', color: '#f0f4ff' },
  ];

  const resolvedBgColor = computed(() => {
    if (background.value === 'transparent') return 'transparent';
    if (background.value === 'white') return '#ffffff';
    if (background.value === 'warm') return '#fffbf0';
    if (background.value === 'cool') return '#f0f4ff';
    if (background.value === 'custom') return customBgColor.value;
    return '#ffffff';
  });

  const THEME_COLORS: Record<string, string> = {
    auto: '#f0f2f5',
    light: '#ffffff',
    dark: '#1e293b',
    blueprint: '#0f172a',
  };

  const previewCanvasStyle = computed(() => {
    const themeBg = THEME_COLORS[theme.value] || '#f0f2f5';
    const style: Record<string, string> = { padding: '16px' };

    if (background.value === 'transparent') {
      style.backgroundImage = `
        linear-gradient(45deg, #ccc 25%, transparent 25%),
        linear-gradient(-45deg, #ccc 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #ccc 75%),
        linear-gradient(-45deg, transparent 75%, #ccc 75%)
      `;
      style.backgroundSize = '16px 16px';
      style.backgroundPosition = '0 0, 0 8px, 8px -8px, -8px 0px';
    } else {
      const isDefaultBg = background.value === 'white' && (theme.value === 'light' || theme.value === 'auto');
      style.backgroundColor = isDefaultBg ? themeBg : resolvedBgColor.value;
    }

    return style;
  });

  function selectBackground(value: string) {
    background.value = value;
  }

  function resetArrow() {
    arrowPoints.value = null;
    arrowClickCount.value = 0;
    arrowInteraction.value = 'idle';
  }

  return {
    theme,
    background,
    customBgColor,
    note,
    arrow,
    watermark,
    callout,
    arrowPoints,
    arrowClickCount,
    arrowInteraction,
    notePoint,
    notePlaceMode,
    noteDragging,
    noteEditing,
    calloutPlaceMode,
    previewDataUrl,
    isCapturing,
    isExporting,
    selectedAnnotation,
    themes,
    backgrounds,
    resolvedBgColor,
    previewCanvasStyle,
    selectBackground,
    resetArrow,
  };
}

export const THEME_BG_FOR_CAPTURE: Record<string, string> = {
  auto: '#ffffff',
  light: '#ffffff',
  dark: '#1e293b',
  blueprint: '#0f172a',
};
