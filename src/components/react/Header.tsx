import React, { FormEventHandler, useEffect, useRef, useState } from "react";
import { trackEvent } from "@/utils/window";
import { PublishButton } from "./PublishButton";
import { setupCloseGuard } from "@/utils/closeGuard";
import { makeDebouncedDraftSaver, loadDraft, clearDraft, primeCloudId, getCachedCloudId, saveDraftSync } from "@/utils/draftStore";
import EventBus from "@/EventBus";
import yaml from "js-yaml";

interface Props {
  saveAndExit: VoidFunction;
  exit: VoidFunction;
}
const Component = ({ saveAndExit, exit }: Props) => {
  const [title, setTitle] = useState("");
  const [parseError, setParseError] = useState<Error | null>(null);
  const originalSpec = useRef<string | null>(null);
  const onRestoreRef = useRef<((p: any) => void) | null>(null);

  // Persist drafts (per keystroke + on close) so accidental Atlassian-X close
  // can be recovered on next open. See src/utils/closeGuard.ts for why we
  // dropped beforeunload. Capture the baseline lazily because Swagger UI
  // injects window.diagram.code asynchronously.
  useEffect(() => {
    let cancelled = false;
    const captureBaseline = (spec: string) => {
      if (originalSpec.current === null && spec) {
        originalSpec.current = spec;
      }
    };
    captureBaseline(window.specContent ?? window.diagram?.code ?? '');

    if (!window.specListeners) window.specListeners = [];
    window.specListeners.push(captureBaseline);

    const diagramId = (window as any).diagram?.id;
    const scope = diagramId ? `edit:${diagramId}` : 'new:openapi';
    const saver = makeDebouncedDraftSaver(scope, 500);
    let saveOnChange: ((spec: string) => void) | null = null;

    let closeGuardOff: (() => void) | null = null;
    let onSaved: ((id: string) => void) | null = null;

    (async () => {
      await primeCloudId();
      if (cancelled) return;

      // Restore prompt if a newer draft is sitting in localStorage.
      const draft = await loadDraft(scope);
      if (draft) {
        const updatedAt = Number((window as any).diagram?.updatedAt) || 0;
        const baseline = originalSpec.current ?? '';
        if (draft.savedAt > updatedAt && draft.code !== baseline) {
          EventBus.$emit('draft-available', { scope, draft });
        } else {
          await clearDraft(scope);
        }
      }

      // Per-keystroke draft via Swagger's spec listener pipeline.
      saveOnChange = (spec: string) => {
        if (originalSpec.current === null || spec === originalSpec.current) return;
        saver.save({ code: spec, title: (window as any).diagram?.title || '' });
      };
      window.specListeners!.push(saveOnChange);

      // view.onClose: synchronously flush the latest spec to localStorage.
      closeGuardOff = setupCloseGuard(() => {
        const current = window.specContent ?? window.diagram?.code ?? '';
        if (originalSpec.current === null || current === originalSpec.current) return;
        const cloudId = getCachedCloudId();
        if (cloudId) {
          saveDraftSync(scope, cloudId, {
            code: current,
            title: (window as any).diagram?.title || '',
          });
        }
      });

      // Clear draft after a successful publish.
      onSaved = () => clearDraft(scope);
      EventBus.$on('saved', onSaved);

      // Restore handler: push the draft spec into Swagger UI.
      const onRestore = (payload: any) => {
        if (payload?.scope !== scope || !payload?.draft) return;
        try {
          (window as any).editor?.specActions?.updateSpec(payload.draft.code);
          if (payload.draft.title && (window as any).diagram) {
            (window as any).diagram.title = payload.draft.title;
          }
          originalSpec.current = ''; // force restored content to count as dirty
          clearDraft(scope);
        } catch (e) {
          console.error('[draft-restore] openapi restore failed', e);
        }
      };
      (onRestoreRef as any).current = onRestore;
      EventBus.$on('draft-restore', onRestore);
    })();

    return () => {
      cancelled = true;
      if (window.specListeners) {
        window.specListeners = window.specListeners.filter(l => l !== captureBaseline && l !== saveOnChange);
      }
      saver.flush();
      closeGuardOff?.();
      if (onSaved) EventBus.$off('saved', onSaved);
      if (onRestoreRef.current) EventBus.$off('draft-restore', onRestoreRef.current);
    };
  }, []);

  const helpClick = () => {
    trackEvent("help", "click", "open-api");
  };

  const setTitleWithSideEffect = (value: any) => {
    setTitle(value);
    if (window.diagram) {
      window.diagram.title = value;
    }
  };

  const changeTitle: FormEventHandler<HTMLInputElement> = e => {
    setTitleWithSideEffect(e.currentTarget.value);
    if (window.diagram) {
      try {
        yaml.loadAll(window.specContent || '', function (data) {
          if (!data) return;
          const doc: Record<string, any> = data as any;
          if (doc && doc.info) {
            doc.info.title = e.currentTarget.value;
            window.editor.specActions.updateSpec(yaml.dump(doc));
          }
        });
        setParseError(null);
      } catch (error) {
        console.error("Error parsing YAML:", error);
        setParseError(error instanceof Error ? error : new Error(String(error)));
        // Still update the title in the UI even if YAML parsing fails
      }
    }
  };
  
  useEffect(() => {
    if (window.diagram) {
      try {
        yaml.loadAll(window.diagram.code || '', function (data) {
          if (!data) return;
          const doc: Record<string, any> = data as any;
          if (doc?.info?.title) setTitleWithSideEffect(doc.info.title);
        });
        setParseError(null);
      } catch (error) {
        console.error("Error parsing YAML in useEffect:", error);
        setParseError(error instanceof Error ? error : new Error(String(error)));
      }
    }
    
    const handleEditorChange = (spec: string) => {
      try {
        yaml.loadAll(spec, function (data) {
          if (!data) return;
          const doc: Record<string, any> = data as any;
          setTitleWithSideEffect(doc?.info?.title || '');
        });
        setParseError(null);
      } catch (error) {
        console.error("Error parsing YAML in editor change:", error);
        setParseError(error instanceof Error ? error : new Error(String(error)));
        // Keep the existing title if parsing fails
      }
    };
    
    if (!window.specListeners) window.specListeners = [];
    window.specListeners.push(handleEditorChange);
    return () => {
      if (!window.specListeners) return
      window.specListeners = window.specListeners.filter(
        (listener: any) => listener !== handleEditorChange
      );
    };
  }, []);

  return (
    <header className="toolbar header border-b border-gray-800 p-2 flex items-center justify-between w-full">
      <div className="flex flex-col">
        <input
          className="px-1 border-2 border-solid border-[#091e4224] rounded-[3px] focus:border-[#388bff] hover:border-[#388bff] outline-none transition-[border-color] leading-7"
          type="text"
          placeholder="Title"
          value={title}
          onInput={changeTitle}
        />
        {parseError && (
          <div className="text-red-500 text-xs mt-1">
            Note: YAML parsing error detected. Title changes may not be saved to the specification.
          </div>
        )}
      </div>
      <div className="flex items-center">
        <a
          className="inline-block help mx-1 ml-2"
          target="_blank"
          href="helpUrl"
        >
          <button
            className="flex items-center bg-gray-100 px-2 py-1 text-gray-600 text-sm font-semibold rounded"
            onClick={helpClick}
          >
            <span>
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                ></path>
              </svg>
            </span>
            <span>Help</span>
          </button>
        </a>
        <div className="inline-block ml-2">
          <PublishButton saveAndExit={saveAndExit} disabled={!title} />
        </div>
      </div>
    </header>
  );
};

export default Component;
