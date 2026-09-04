import React, { FormEventHandler, useEffect, useRef, useState } from 'react';
import { watch } from 'vue';
import { DiagramType } from '@/model/Diagram/Diagram';
import store from '@/model/store2';
import { useAutoTitle } from '@/composables/useAutoTitle';
import { buildOpenApiAiTitleContent } from '@/model/OpenApi/OpenApiEditorState';

const AUTO_DEBOUNCE_MS = 1500;

interface Props {
  title: string;
  spec: string;
  parseError: Error | null;
  onTitleChange: (title: string) => void;
}

interface AutoTitleSnapshot {
  aiTitleEnabled: boolean;
  isGeneratingTitle: boolean;
  isAnimating: boolean;
  displayedTitle: string;
  showSpark: boolean;
  sparkFadingOut: boolean;
  showDismiss: boolean;
  autoNameAnimationDone: boolean;
}

function snapshot(autoTitle: ReturnType<typeof useAutoTitle>): AutoTitleSnapshot {
  return {
    aiTitleEnabled: autoTitle.aiTitleEnabled.value,
    isGeneratingTitle: autoTitle.isGeneratingTitle.value,
    isAnimating: autoTitle.isAnimating.value,
    displayedTitle: autoTitle.displayedTitle.value,
    showSpark: autoTitle.showSpark.value,
    sparkFadingOut: autoTitle.sparkFadingOut.value,
    showDismiss: autoTitle.showDismiss.value,
    autoNameAnimationDone: autoTitle.autoNameAnimationDone.value,
  };
}

/**
 * React presentation adapter for the shared Vue AI-title state machine.
 *
 * The OpenAPI editor is React while the sequence and graph editors are Vue.
 * Watching the composable's refs here keeps the generation rules, analytics,
 * feature flag, deduplication and animation timings shared instead of growing
 * a second implementation that can drift.
 */
export default function OpenApiTitleInput({ title, spec, parseError, onTitleChange }: Props) {
  const autoTitleRef = useRef<ReturnType<typeof useAutoTitle> | null>(null);
  if (!autoTitleRef.current) autoTitleRef.current = useAutoTitle();
  const autoTitle = autoTitleRef.current;

  const [state, setState] = useState<AutoTitleSnapshot>(() => snapshot(autoTitle));
  const titleRef = useRef(title);
  const specRef = useRef(spec);
  const onTitleChangeRef = useRef(onTitleChange);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedTitleSyncedRef = useRef(false);

  titleRef.current = title;
  specRef.current = spec;
  onTitleChangeRef.current = onTitleChange;

  const scheduleAutoGenerate = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void autoTitle.generate('init', {
        code: buildOpenApiAiTitleContent(specRef.current),
        diagramType: DiagramType.OpenApi,
        currentTitle: titleRef.current,
      });
    }, AUTO_DEBOUNCE_MS);
  };

  useEffect(() => {
    autoTitle.reset();
    setState(snapshot(autoTitle));
    const stop = watch(
      [
        autoTitle.aiTitleEnabled,
        autoTitle.isGeneratingTitle,
        autoTitle.isAnimating,
        autoTitle.displayedTitle,
        autoTitle.showSpark,
        autoTitle.sparkFadingOut,
        autoTitle.showDismiss,
        autoTitle.autoNameAnimationDone,
      ],
      () => {
        const next = snapshot(autoTitle);
        setState(next);

        // useAutoTitle commits the completed title to Vuex. Mirror that single
        // committed value into React and info.title exactly once per generation.
        if (next.autoNameAnimationDone && !generatedTitleSyncedRef.current) {
          generatedTitleSyncedRef.current = true;
          onTitleChangeRef.current(store.state.diagram.title || '');
        } else if (!next.autoNameAnimationDone) {
          generatedTitleSyncedRef.current = false;
        }
      },
      { flush: 'sync' },
    );

    setState(snapshot(autoTitle));
    scheduleAutoGenerate();

    return () => {
      stop();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      autoTitle.reset();
    };
  }, []);

  useEffect(() => {
    scheduleAutoGenerate();
    // Spec changes are the OpenAPI equivalent of DSL edits in the Vue editor.
  }, [spec]);

  const handleInput: FormEventHandler<HTMLInputElement> = (event) => {
    const value = event.currentTarget.value;
    if (value) {
      autoTitle.markManualEdit();
    } else {
      autoTitle.onTitleCleared();
      scheduleAutoGenerate();
    }
    onTitleChange(value);
  };

  const handleManualGenerate = () => {
    void autoTitle.generate('user', {
      code: buildOpenApiAiTitleContent(specRef.current),
      diagramType: DiagramType.OpenApi,
      currentTitle: titleRef.current,
    });
  };

  const handleDismiss = () => {
    autoTitle.dismiss();
    onTitleChange('');
  };

  const handleClear = () => {
    autoTitle.onTitleCleared();
    scheduleAutoGenerate();
    onTitleChange('');
  };

  const displayTitle = state.isAnimating ? state.displayedTitle : title;

  return (
    <div className="flex flex-col flex-1 min-w-0 max-w-2xl mr-2">
      <div className="group/openapi-title flex h-6 items-center w-full px-1.5 border border-transparent rounded transition-colors focus-within:bg-white focus-within:border-[#388bff] hover:bg-black/[0.05]">
        {(state.aiTitleEnabled || state.autoNameAnimationDone) && (
          <button
            type="button"
            className={`openapi-autoname-spark h-[18px] w-[18px] rounded p-0.5 mr-[5px] flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-[width,margin,color,opacity] duration-200 ${
              (state.isGeneratingTitle || state.showSpark) && !state.sparkFadingOut
                ? 'openapi-autoname-spark-in text-purple-500'
                : ''
            } ${state.sparkFadingOut ? 'openapi-autoname-spark-out' : ''} ${(!displayTitle || state.isGeneratingTitle || state.showSpark) ? 'opacity-100' : 'w-0 mr-0 overflow-hidden opacity-0 group-hover/openapi-title:w-[18px] group-hover/openapi-title:mr-[5px] group-hover/openapi-title:opacity-100 group-focus-within/openapi-title:w-[18px] group-focus-within/openapi-title:mr-[5px] group-focus-within/openapi-title:opacity-100'}`}
            title="Generate title with AI"
            disabled={state.isGeneratingTitle || state.isAnimating}
            onClick={handleManualGenerate}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
            </svg>
          </button>
        )}

        <input
          className={`flex-1 min-w-0 bg-transparent outline-none text-[14px] font-semibold text-[#111827] placeholder:italic placeholder:text-gray-400 ${state.isAnimating ? 'openapi-autoname-typing' : ''}`}
          type="text"
          placeholder="Name your API…"
          value={displayTitle}
          onInput={handleInput}
          readOnly={state.isAnimating}
        />

        {state.showDismiss && (
          <button
            type="button"
            className="openapi-autoname-dismiss flex items-center justify-center flex-shrink-0"
            title="Dismiss suggested title"
            onClick={handleDismiss}
          >
            <svg width="14" height="14" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {!state.showDismiss && displayTitle && (
          <button type="button" className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-gray-400 opacity-0 transition-opacity group-hover/openapi-title:opacity-100 group-focus-within/openapi-title:opacity-100 hover:bg-gray-100 hover:text-gray-600" title="Clear title" onClick={handleClear}>
            <svg width="14" height="14" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M6 16 16 6M6 6l10 10" /></svg>
          </button>
        )}
      </div>

      {parseError && (
        <div className="text-red-500 text-xs mt-1">
          Note: YAML parsing error detected. Title changes may not be saved to the specification.
        </div>
      )}
    </div>
  );
}
