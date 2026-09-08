// Outline SVG path data for the export toolbar. Heroicons v2 is already a
// project dependency; its Vue components cannot be used by this v-html based
// component, so the 24x24 path data is inlined here. AdsIcon supplies the
// shared 1.5px currentColor outline attributes. Keys map UI action -> glyph.
export const ADS_ICONS = {
  /** Heroicons ArrowUpRightIcon — draw arrow (matches the Figma toolbar's diagonal arrow, not a horizontal one). */
  arrow: "<path d=\"M4.5 19.5 19.5 4.5m0 0H8.25m11.25 0v11.25\"/>",
  /** A simple text-tool T (Heroicons has no standalone TextIcon). */
  text: "<path d=\"M5.25 5.25h13.5M12 5.25v13.5\"/>",
  /** Heroicons ChatBubbleLeftIcon — add callout. */
  comment: "<path d=\"M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z\"/>",
  /** Heroicons LockClosedIcon — retained for callers that need a lock. */
  lock: "<path d=\"M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z\"/>",
  /** Heroicons ArrowPathIcon — refresh preview. */
  refresh: "<path d=\"M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99\"/>",
  /** Heroicons XMarkIcon — close. */
  cross: "<path d=\"M6 18 18 6M6 6l12 12\"/>",
  /** Heroicons ArrowDownTrayIcon — download. */
  download: "<path d=\"M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3\"/>",
  /** Heroicons Square2StackIcon — copy. */
  copy: "<path d=\"M16.5 8.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v8.25A2.25 2.25 0 0 0 6 16.5h2.25m8.25-8.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-7.5A2.25 2.25 0 0 1 8.25 18v-1.5m8.25-8.25h-6a2.25 2.25 0 0 0-2.25 2.25v6\"/>",
  /** Heroicons TrashIcon — remove. */
  trash: "<path d=\"m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0\"/>",
  /** Heroicons PlusIcon — add. */
  add: "<path d=\"M12 4.5v15m7.5-7.5h-15\"/>",
  /** Heroicons InformationCircleIcon — information. */
  info: "<path d=\"m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z\"/>",
  /** Heroicons CheckIcon — success. */
  check: "<path d=\"m4.5 12.75 6 6 9-13.5\"/>",
  /** Heroicons CursorArrowRaysIcon pointer body, without its rays. */
  select: "<path d=\"M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672Z\"/>",
  /** One outlined rectangle (Heroicons has no standalone RectangleIcon). */
  rectangle: "<rect x=\"4.5\" y=\"4.5\" width=\"15\" height=\"15\" rx=\"1.5\"/>",
  /** A small rubber-stamp outline (Heroicons has no StampIcon). */
  stamp: "<path d=\"M9 3.75h6v3.375a3 3 0 0 0 1.5 2.598l.75.433V12H6.75v-1.844l.75-.433A3 3 0 0 0 9 7.125V3.75Z\"/><path d=\"M9.75 12v3.75m4.5-3.75v3.75M6.75 15.75h10.5A2.25 2.25 0 0 1 19.5 18v.75h-15V18a2.25 2.25 0 0 1 2.25-2.25ZM4.5 21h15\"/>",
} as const;

export type AdsIconName = keyof typeof ADS_ICONS;
