import React, { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/utils/window";
import { PublishButton } from "./PublishButton";
import { setupCloseGuard } from "@/utils/closeGuard";
import { makeDebouncedDraftSaver, loadDraft, clearDraft, primeCloudId, getCachedCloudId, getCachedSavedVersionUpdatedAt, saveDraftSync, isDraftNewerThanSaved } from "@/utils/draftStore";
import EventBus from "@/EventBus";
import yaml from "js-yaml";
import { openUrl } from "@/model/globals/forgeGlobal";
import { getOpenApiTitleField } from '@/model/OpenApi/OpenApiEditorState';
import OpenApiTitleInput from '@/components/react/OpenApiTitleInput';
import store from '@/model/store2';
import { isAiChatEnabled } from '@/apis/aiTitleFeatureFlag';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

// Docs link for the OpenAPI editor's Help button — mirrors the URL the Vue
// header uses (components/Header/Header.vue). Opened via openUrl() because a
// plain <a target="_blank"> is sandboxed/blocked inside the Forge Custom UI
// iframe; openUrl routes through @forge/bridge's router.open under Forge.
const HELP_URL =
  "https://zenuml.com/docs?utm_source=confluence-plugin&utm_medium=help-button&utm_campaign=confluence-plugin";

interface Props {
  saveAndExit: VoidFunction;
  exit: VoidFunction;
  aiChatOpen?: boolean;
  onToggleAiChat?: VoidFunction;
}
const Component = ({
  saveAndExit,
  exit: _exit,
  aiChatOpen = false,
  onToggleAiChat,
}: Props) => {
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState(() => window.specContent ?? window.diagram?.code ?? '');
  const [parseError, setParseError] = useState<Error | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [aiChatEnabled, setAiChatEnabled] = useState(false);
  const originalSpec = useRef<string | null>(null);
  const onRestoreRef = useRef<((p: any) => void) | null>(null);
  const savingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiChatWasVisibleRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    isAiChatEnabled().then((enabled) => {
      if (!cancelled) setAiChatEnabled(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const aiChatVisible = aiChatEnabled && !!onToggleAiChat;
  useEffect(() => {
    if (aiChatVisible && !aiChatWasVisibleRef.current) {
      trackAnalyticsEvent("ai_chat_button_shown", {
        feature_area: "ai",
        surface: "editor",
        macro_type: "openapi",
      });
    }
    aiChatWasVisibleRef.current = aiChatVisible;
  }, [aiChatVisible]);

  // Show the spinner immediately on Publish — the async save chain
  // (saveToPlatform → view.submit) takes seconds with no other feedback, and
  // the button would otherwise stay clickable (double-fire). Cleared on the
  // `saved`/`save-error` events below.
  const handleSaveAndExit = () => {
    if (isSaving) return;
    setIsSaving(true);
    if (savingTimeoutRef.current) clearTimeout(savingTimeoutRef.current);
    // Safety net so an unexpected hang can't strand the spinner.
    savingTimeoutRef.current = setTimeout(() => setIsSaving(false), 20000);
    saveAndExit();
  };

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
    let onSaveError: (() => void) | null = null;

    const resetSaving = () => {
      setIsSaving(false);
      if (savingTimeoutRef.current) {
        clearTimeout(savingTimeoutRef.current);
        savingTimeoutRef.current = null;
      }
    };

    (async () => {
      await primeCloudId();
      if (cancelled) return;

      // Restore prompt if a newer draft is sitting in localStorage.
      const draft = await loadDraft(scope);
      if (draft) {
        const baseline = originalSpec.current ?? '';
        const savedVersionUpdatedAt = getCachedSavedVersionUpdatedAt() ?? (window as any).diagram?.updatedAt;
        if (isDraftNewerThanSaved(draft, savedVersionUpdatedAt) && draft.code !== baseline) {
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

      // Clear draft + release the Publish button after a successful publish.
      onSaved = () => {
        resetSaving();
        saver.cancel();
        clearDraft(scope);
      };
      EventBus.$on('saved', onSaved);

      // Release the Publish button when a save fails — the editor stays open
      // for retry (see forge-swagger-editor.ts), so the spinner must clear.
      onSaveError = () => resetSaving();
      EventBus.$on('save-error', onSaveError);

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
      if (savingTimeoutRef.current) clearTimeout(savingTimeoutRef.current);
      if (onSaved) EventBus.$off('saved', onSaved);
      if (onSaveError) EventBus.$off('save-error', onSaveError);
      if (onRestoreRef.current) EventBus.$off('draft-restore', onRestoreRef.current);
    };
  }, []);

  const helpClick = () => {
    trackEvent("help", "click", "open-api");
    void openUrl(HELP_URL);
  };

  const setTitleWithSideEffect = (value: string) => {
    setTitle(value);
    store.dispatch('updateTitle', value);
    if (window.diagram) {
      window.diagram.title = value;
    }
  };

  const changeTitle = (value: string) => {
    setTitleWithSideEffect(value);
    if (window.diagram) {
      try {
        yaml.loadAll(window.specContent || spec || '', function (data) {
          if (!data) return;
          const doc: Record<string, any> = data as any;
          if (doc && doc.info) {
            doc.info.title = value;
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
        setSpec(window.diagram.code || '');
        yaml.loadAll(window.diagram.code || '', function (data) {
          if (!data) return;
          const doc: Record<string, any> = data as any;
          const nextTitle = getOpenApiTitleField(doc);
          if (nextTitle !== undefined) setTitleWithSideEffect(nextTitle);
        });
        setParseError(null);
      } catch (error) {
        console.error("Error parsing YAML in useEffect:", error);
        setParseError(error instanceof Error ? error : new Error(String(error)));
      }
    }
    
    const handleEditorChange = (spec: string) => {
      setSpec(spec);
      try {
        yaml.loadAll(spec, function (data) {
          if (!data) return;
          const doc: Record<string, any> = data as any;
          const nextTitle = getOpenApiTitleField(doc);
          if (nextTitle !== undefined) {
            setTitleWithSideEffect(nextTitle);
          }
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
    <header className="toolbar header flex h-8 w-full items-center justify-between gap-3 bg-[#F1F3F4] px-3">
      <div className="flex flex-1 items-center gap-2">
        {aiChatVisible && (
          <button
            type="button"
            className={`flex h-6 items-center gap-1 rounded px-2 text-xs font-medium transition-colors ${
              aiChatOpen
                ? "bg-violet-100 text-violet-800"
                : "bg-gray-100 text-gray-600 hover:bg-violet-50 hover:text-violet-700"
            }`}
            data-testid="react-ai-chat-toggle"
            onClick={onToggleAiChat}
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m12 3-1.2 3.2L7.5 7.5l3.3 1.3L12 12l1.2-3.2 3.3-1.3-3.3-1.3L12 3Z" />
              <path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8L5 14Z" />
            </svg>
            <span>AI Chat</span>
          </button>
        )}
        <button
          type="button"
          className="help flex h-6 items-center gap-1 rounded px-2 text-xs font-medium text-gray-500 hover:bg-gray-200 hover:text-gray-700 cursor-pointer transition-colors duration-200"
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
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <OpenApiTitleInput
          title={title}
          spec={spec}
          parseError={parseError}
          onTitleChange={changeTitle}
        />
        <div className="inline-block shrink-0">
          <PublishButton saveAndExit={handleSaveAndExit} disabled={!title} loading={isSaving} />
        </div>
      </div>
    </header>
  );
};

export default Component;
