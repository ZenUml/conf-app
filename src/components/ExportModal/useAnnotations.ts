import { computed, ref } from 'vue';
import type { Point } from './useExportState';

export type AnnotationType = 'note' | 'arrow' | 'callout' | 'rectangle';

/** Coordinates are relative to the source image, independent of preview zoom. */
export interface Annotation {
  id: string;
  type: AnnotationType;
  position: Point;
  end: Point;
  text: string;
  color: string;
  bgColor: string;
  fontSize: number;
  thickness: number;
  arrowType: '→' | '←' | '←→';
}

export function useAnnotations() {
  const items = ref<Annotation[]>([]);
  const selectedId = ref<string | null>(null);
  const selected = computed(() => items.value.find(item => item.id === selectedId.value) ?? null);

  function select(id: string | null) {
    selectedId.value = items.value.some(item => item.id === id) ? id : null;
  }

  function add(type: AnnotationType, position: Point): Annotation {
    const item: Annotation = {
      id: crypto.randomUUID(), type, position: { ...position }, end: { ...position },
      text: '', color: type === 'note' || type === 'callout' ? '#374151' : '#ef4444',
      bgColor: type === 'callout' ? '#fffde7' : 'none', fontSize: 14, thickness: 2, arrowType: '→',
    };
    items.value.push(item);
    selectedId.value = item.id;
    return item;
  }

  function update(id: string, patch: Partial<Omit<Annotation, 'id' | 'type'>>) {
    const item = items.value.find(item => item.id === id);
    if (item) Object.assign(item, patch);
  }

  function remove(id: string) {
    items.value = items.value.filter(item => item.id !== id);
    if (selectedId.value === id) selectedId.value = null;
  }

  return { items, selectedId, selected, add, select, update, remove };
}

export type AnnotationsState = ReturnType<typeof useAnnotations>;
