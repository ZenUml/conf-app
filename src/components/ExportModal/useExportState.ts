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
  type: string;
  label: string;
  color: string;
  thickness: number;
}

export interface WatermarkState {
  text: string;
  opacity: number;
  fontSize: number;
  color: string;
  position: 'diagonal' | 'bottom-right';
}

export interface BackgroundOption {
  value: string;
  label: string;
  color: string;
}

export type ArrowInteractionState = 'idle' | 'creating' | 'placed';

export type ActiveTool = 'arrow' | 'callout' | 'note' | 'watermark' | null;

export interface CalloutState {
  text: string;
  fontSize: number;
  color: string;
  bgColor: string;
  position: Point | null;
  tipPosition: Point | null;
}

export interface ExportState {
  background: Ref<string>;
  customBgColor: Ref<string>;
  note: NoteState;
  arrow: ArrowState;
  watermark: WatermarkState;
  callout: CalloutState;
  activeTool: Ref<ActiveTool>;
  arrowPoints: Ref<ArrowPoints | null>;
  arrowClickCount: Ref<number>;
  arrowInteraction: Ref<ArrowInteractionState>;
  notePoint: Ref<Point | null>;
  noteDragging: Ref<boolean>;
  noteEditing: Ref<boolean>;
  watermarkVisible: Ref<boolean>;
  previewDataUrl: Ref<string | null>;
  previewNaturalWidth: Ref<number>;
  previewNaturalHeight: Ref<number>;
  isCapturing: Ref<boolean>;
  isExporting: Ref<boolean>;
  selectedAnnotation: Ref<'note' | 'arrow' | 'watermark' | 'callout' | null>;

  backgrounds: BackgroundOption[];

  resolvedBgColor: ReturnType<typeof computed<string>>;
  previewCanvasStyle: ReturnType<typeof computed<Record<string, string>>>;

  hasArrow: ReturnType<typeof computed<boolean>>;
  hasNote: ReturnType<typeof computed<boolean>>;
  hasCallout: ReturnType<typeof computed<boolean>>;
  hasWatermark: ReturnType<typeof computed<boolean>>;

  selectBackground: (value: string) => void;
  resetArrow: () => void;
  removeAnnotation: (type: 'note' | 'arrow' | 'watermark' | 'callout') => void;
}

export function useExportState(): ExportState {
  const background = ref('white');
  const customBgColor = ref('#ffffff');
  const previewDataUrl = ref<string | null>(null);
  const previewNaturalWidth = ref(600);
  const previewNaturalHeight = ref(400);
  const isCapturing = ref(false);
  const isExporting = ref(false);
  const activeTool = ref<ActiveTool>(null);
  const arrowPoints = ref<ArrowPoints | null>(null);
  const arrowClickCount = ref(0);
  const arrowInteraction = ref<ArrowInteractionState>('idle');
  const notePoint = ref<Point | null>(null);
  const noteDragging = ref(false);
  const noteEditing = ref(false);
  const watermarkVisible = ref(false);
  const selectedAnnotation = ref<'note' | 'arrow' | 'watermark' | 'callout' | null>(null);

  const note: NoteState = reactive({
    text: '',
    position: 'bottom-center',
    fontSize: 14,
    color: '#374151',
  });

  const arrow: ArrowState = reactive({
    type: '→',
    label: '',
    color: '#ef4444',
    thickness: 2,
  });

  const watermark: WatermarkState = reactive({
    text: 'Confidential',
    opacity: 20,
    fontSize: 24,
    color: '#9ca3af',
    position: 'diagonal',
  });

  const callout: CalloutState = reactive({
    text: '',
    fontSize: 14,
    color: '#1e293b',
    bgColor: '#fffde7',
    position: null,
    tipPosition: null,
  });

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

  const previewCanvasStyle = computed(() => {
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
      style.backgroundColor = resolvedBgColor.value;
    }

    return style;
  });

  const hasArrow = computed(() => arrowPoints.value !== null && arrowInteraction.value === 'placed');
  const hasNote = computed(() => !!note.text);
  const hasCallout = computed(() => !!callout.position && !!callout.text);
  const hasWatermark = computed(() => watermarkVisible.value && !!watermark.text);

  function selectBackground(value: string) {
    background.value = value;
  }

  function resetArrow() {
    arrowPoints.value = null;
    arrowClickCount.value = 0;
    arrowInteraction.value = 'idle';
  }

  function removeAnnotation(type: 'note' | 'arrow' | 'watermark' | 'callout') {
    if (type === 'arrow') {
      resetArrow();
    } else if (type === 'note') {
      note.text = '';
      notePoint.value = null;
    } else if (type === 'watermark') {
      watermarkVisible.value = false;
    } else if (type === 'callout') {
      callout.text = '';
      callout.position = null;
      callout.tipPosition = null;
    }
    selectedAnnotation.value = null;
  }

  return {
    background,
    customBgColor,
    note,
    arrow,
    watermark,
    callout,
    activeTool,
    arrowPoints,
    arrowClickCount,
    arrowInteraction,
    notePoint,
    noteDragging,
    noteEditing,
    watermarkVisible,
    previewDataUrl,
    previewNaturalWidth,
    previewNaturalHeight,
    isCapturing,
    isExporting,
    selectedAnnotation,
    backgrounds,
    resolvedBgColor,
    previewCanvasStyle,
    hasArrow,
    hasNote,
    hasCallout,
    hasWatermark,
    selectBackground,
    resetArrow,
    removeAnnotation,
  };
}

