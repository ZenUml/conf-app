import React, {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AI_CHAT_SUGGESTIONS,
  buildDiffLines,
  createCodePreview,
  formatVersionTime,
  type AIChatChangePreview,
  type AIChatChangeKind,
  type AIChatMessage,
  type AIChatSuggestion,
  type AIChatVersion,
} from "@/components/AIChat/aiChatPrototype";
import {
  AI_CHAT_NO_CHANGE_MESSAGE,
  getAIChatFailureTelemetry,
  runAIChatSession,
  type AIChatFailurePhase,
  type AIChatSessionStage,
} from "@/services/AIChatSessionService";
import {
  getDiagramlyVersions,
  restoreDiagramlyVersion,
  type DiagramlyVersion,
} from "@/services/GenerateService";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import type { MacroTypeValue } from "@/utils/analytics/catalog";
import "@/assets/ai-chat.css";

export type { AIChatMessage };

export interface AIChatPanelProps {
  open: boolean;
  codeVisible?: boolean;
  diagramType?: string;
  syntaxError?: string;
  syntaxRepairRequestId?: number;
  currentCode?: string;
  diagramTitle?: string;
  diagramlyDiagramId?: string;
  initialMessages?: AIChatMessage[];
  onClose: () => void;
  onToggleCode?: () => void;
  onSend?: (prompt: string) => void;
  onApply?: (message: AIChatMessage) => void;
  onApplyCode?: (code: string) => void;
  onDiagramlyDiagramBound?: (diagramId: string) => void | Promise<void>;
}

const stages: Array<{ key: AIChatSessionStage; label: string }> = [
  { key: "ensuring", label: "Preparing diagram" },
  { key: "queued", label: "Understanding request" },
  { key: "processing", label: "Updating diagram" },
  { key: "generating", label: "Generating code" },
  { key: "syncing", label: "Syncing changes" },
];

type AIChatIconName =
  | "arrow"
  | "back"
  | "check"
  | "chevron-down"
  | "chevron-up"
  | "clock"
  | "close"
  | "code"
  | "expand"
  | "send"
  | "sparkles"
  | "spinner"
  | "undo"
  | "warning";

const iconPaths: Record<AIChatIconName, string[]> = {
  arrow: ["M5 12h14", "m13-6 6 6-6 6"],
  back: ["M19 12H5", "m11 18-6-6 6-6"],
  check: ["m5 12 4 4L19 6"],
  "chevron-down": ["m6 9 6 6 6-6"],
  "chevron-up": ["m6 15 6-6 6 6"],
  clock: ["M12 6v6l4 2", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
  close: ["M6 6l12 12", "M18 6 6 18"],
  code: ["m8 8-4 4 4 4", "m8-8 4 4-4 4", "m14 4-4 16"],
  expand: ["M8 3H3v5", "m3 3 6 6", "M16 21h5v-5", "m-3-3 6 6"],
  send: ["m4 4 16 8-16 8 3-8-3-8Z", "M7 12h13"],
  sparkles: [
    "m9 3 1.2 3.3L13.5 7.5l-3.3 1.2L9 12 7.8 8.7 4.5 7.5l3.3-1.2L9 3Z",
    "m17 12 .8 2.2L20 15l-2.2.8L17 18l-.8-2.2L14 15l2.2-.8L17 12Z",
  ],
  spinner: ["M20 12a8 8 0 1 1-2.3-5.7"],
  undo: ["M9 8 5 12l4 4", "M5 12h8a6 6 0 0 1 6 6"],
  warning: ["M12 9v4", "M12 17h.01", "M10.3 4.6 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z"],
};

function AIChatIcon({ name, className }: { name: AIChatIconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

function cloneMessage(message: AIChatMessage): AIChatMessage {
  return {
    ...message,
    preview: message.preview
      ? {
          ...message.preview,
          items: [...message.preview.items],
          diffLines: message.preview.diffLines.map((line) => ({ ...line })),
        }
      : undefined,
  };
}

export default function AIChatPanel({
  open,
  codeVisible = false,
  diagramType = "openapi",
  syntaxError = "",
  syntaxRepairRequestId = 0,
  currentCode = "",
  diagramTitle = "",
  diagramlyDiagramId = "",
  initialMessages = [],
  onClose,
  onToggleCode,
  onSend,
  onApply,
  onApplyCode,
  onDiagramlyDiagramBound,
}: AIChatPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AIChatMessage[]>(() =>
    initialMessages.map(cloneMessage),
  );
  const [isThinking, setIsThinking] = useState(false);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  const [activeStage, setActiveStage] = useState<AIChatSessionStage | null>(null);
  const [openDiffIds, setOpenDiffIds] = useState<string[]>([]);
  const [expandedDiffMessageId, setExpandedDiffMessageId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<AIChatVersion[]>([]);
  const [versionsStatus, setVersionsStatus] = useState<
    "idle" | "loading" | "loaded" | "failed"
  >("idle");
  const [restoringVersionId, setRestoringVersionId] = useState("");
  const [restoringAction, setRestoringAction] = useState<"undo" | "rollback" | null>(null);
  const [syntaxResolved, setSyntaxResolved] = useState(false);
  const contentRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const activeStageRef = useRef<AIChatSessionStage | null>(null);
  const activeRequestStartedAtRef = useRef(0);
  const activeRequestKindRef = useRef<AIChatChangeKind | null>(null);
  const activeDiagramIdRef = useRef(diagramlyDiagramId.trim());
  const activeCodeRef = useRef(currentCode);
  const activeVersionIdRef = useRef("");
  const versionsRef = useRef<AIChatVersion[]>([]);
  const versionsStatusRef = useRef<"idle" | "loading" | "loaded" | "failed">("idle");
  const versionsDiagramIdRef = useRef("");
  const versionsRequestSequenceRef = useRef(0);
  const versionLoadPromiseRef = useRef<Promise<void> | null>(null);
  const restoreRequestSequenceRef = useRef(0);
  const restoreStartedAtRef = useRef(0);
  const restoringVersionIdRef = useRef("");
  const restoringActionRef = useRef<"undo" | "rollback" | null>(null);
  const lastHandledSyntaxRepairRequestIdRef = useRef(0);
  const messageSequenceRef = useRef(0);
  const messageCountRef = useRef(initialMessages.length);
  const pendingInputSourceRef = useRef<"typed" | "suggestion">("typed");
  const lastPromptFailedRef = useRef(false);
  const lastTrackedSyntaxIssueRef = useRef("");

  const diagramTypeLabel = useMemo(() => {
    const labels: Record<string, string> = {
      sequence: "Sequence",
      mermaid: "Mermaid",
      plantuml: "PlantUML",
      openapi: "OpenAPI",
    };
    return labels[diagramType.toLowerCase()] || "Current";
  }, [diagramType]);
  const macroType = useMemo<MacroTypeValue>(() => {
    const value = diagramType.toLowerCase();
    const supported: MacroTypeValue[] = [
      "sequence",
      "mermaid",
      "graph",
      "openapi",
      "embed",
      "plantuml",
    ];
    return supported.includes(value as MacroTypeValue)
      ? value as MacroTypeValue
      : "none";
  }, [diagramType]);
  const activeStageIndex = stages.findIndex((stage) => stage.key === activeStage);
  const isBusy = isThinking || isRestoringVersion;
  const canSubmit = prompt.trim().length > 0 && !isBusy;
  const visibleSyntaxError = Boolean(syntaxError) && !syntaxResolved;
  const syntaxErrorSummary = syntaxError.split("\n")[0];
  const reversedVersions = useMemo(
    () => [...versions].sort((first, second) => second.versionNumber - first.versionNumber),
    [versions],
  );
  const versionCountLabel = versionsStatus === "loading"
    ? "..."
    : versionsStatus === "failed"
      ? "!"
      : String(versions.length);
  const expandedDiffPreview = useMemo(
    () => messages.find((message) => message.id === expandedDiffMessageId)?.preview || null,
    [expandedDiffMessageId, messages],
  );

  function analyticsBase() {
    return {
      feature_area: "ai" as const,
      surface: "editor" as const,
      macro_type: macroType,
    };
  }

  function durationSince(startedAt: number): number {
    return Math.max(0, Date.now() - startedAt);
  }

  function failurePhaseForStage(stage: AIChatSessionStage | null): AIChatFailurePhase {
    if (stage === "ensuring") return "ensure";
    if (stage === "syncing") return "sync";
    if (stage === "queued" || stage === "processing" || stage === "generating") {
      return "poll";
    }
    return "start";
  }

  function updateActiveStage(stage: AIChatSessionStage | null): void {
    activeStageRef.current = stage;
    setActiveStage(stage);
  }

  function nextMessageId(role: AIChatMessage["role"]): string {
    messageSequenceRef.current += 1;
    return `${role}-${Date.now()}-${messageSequenceRef.current}`;
  }

  function updateVersionsStatus(
    status: "idle" | "loading" | "loaded" | "failed",
  ): void {
    versionsStatusRef.current = status;
    setVersionsStatus(status);
  }

  function replaceVersions(nextVersions: AIChatVersion[]): void {
    versionsRef.current = nextVersions;
    setVersions(nextVersions);
  }

  function toAIChatVersion(version: DiagramlyVersion): AIChatVersion {
    const instruction = version.instruction?.trim();
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      summary: version.versionNumber === 1
        ? "Initial version"
        : instruction || version.title || `Version ${version.versionNumber}`,
      detail: version.comment || (instruction
        ? `Created from: ${instruction}`
        : `Saved Diagramly version ${version.versionNumber}.`),
      syntaxResolved: true,
      time: formatVersionTime(version.createdAt),
      code: version.content?.code,
    };
  }

  function nextVersionNumber(): number {
    return Math.max(0, ...versionsRef.current.map((version) => version.versionNumber)) + 1;
  }

  function upsertVersion(version: AIChatVersion): void {
    const existingIndex = versionsRef.current.findIndex((item) => item.id === version.id);
    const nextVersions = [...versionsRef.current];
    if (existingIndex >= 0) nextVersions.splice(existingIndex, 1, version);
    else nextVersions.push(version);
    replaceVersions(nextVersions);
  }

  async function loadPersistedVersions(
    diagramId = activeDiagramIdRef.current,
    force = false,
    isRetry = false,
  ): Promise<void> {
    if (!diagramId) {
      replaceVersions([]);
      updateVersionsStatus("loaded");
      versionsDiagramIdRef.current = "";
      activeVersionIdRef.current = "";
      return;
    }
    if (!force && versionsDiagramIdRef.current === diagramId) {
      if (versionsStatusRef.current === "loaded") return;
      if (versionsStatusRef.current === "loading" && versionLoadPromiseRef.current) {
        await versionLoadPromiseRef.current;
        return;
      }
    }

    const requestId = ++versionsRequestSequenceRef.current;
    const startedAt = Date.now();
    versionsDiagramIdRef.current = diagramId;
    updateVersionsStatus("loading");
    const request = (async () => {
      try {
        const result = await getDiagramlyVersions(diagramId);
        if (
          requestId !== versionsRequestSequenceRef.current
          || activeDiagramIdRef.current !== diagramId
        ) {
          return;
        }

        const nextVersions = [...(result.versions || [])]
          .sort((first, second) => first.versionNumber - second.versionNumber)
          .map(toAIChatVersion);
        replaceVersions(nextVersions);
        activeVersionIdRef.current = result.diagram?.currentVersionId
          || nextVersions[nextVersions.length - 1]?.id
          || "";
        updateVersionsStatus("loaded");
        trackAnalyticsEvent("ai_chat_history_load_succeeded", {
          ...analyticsBase(),
          duration_ms: durationSince(startedAt),
          version_count: nextVersions.length,
          is_retry: isRetry,
          ui_component: "version_history",
        });
      } catch {
        if (
          requestId === versionsRequestSequenceRef.current
          && activeDiagramIdRef.current === diagramId
        ) {
          updateVersionsStatus("failed");
          trackAnalyticsEvent("ai_chat_history_load_failed", {
            ...analyticsBase(),
            failure_phase: "history_load",
            failure_reason: "history_request_failed",
            duration_ms: durationSince(startedAt),
            is_retry: isRetry,
            ui_component: "version_history",
          });
        }
      }
    })();

    versionLoadPromiseRef.current = request;
    await request;
    if (versionLoadPromiseRef.current === request) versionLoadPromiseRef.current = null;
  }

  function retryLoadVersions(): void {
    void loadPersistedVersions(activeDiagramIdRef.current, true, true);
  }

  function cancelActiveRequest(
    cancelReason: "panel_closed" | "component_unmounted" = "component_unmounted",
    resetUi = true,
  ): void {
    const controller = activeControllerRef.current;
    if (controller && !controller.signal.aborted) {
      trackAnalyticsEvent("ai_chat_prompt_cancelled", {
        ...analyticsBase(),
        failure_phase: failurePhaseForStage(activeStageRef.current),
        failure_reason: "user_cancelled",
        cancel_reason: cancelReason,
        duration_ms: activeRequestStartedAtRef.current
          ? durationSince(activeRequestStartedAtRef.current)
          : 0,
        chat_message_count: messageCountRef.current,
        change_kind: activeRequestKindRef.current || "request",
      });
    }
    if (restoreStartedAtRef.current && restoringVersionIdRef.current) {
      trackAnalyticsEvent("ai_chat_version_restore_failed", {
        ...analyticsBase(),
        failure_phase: "version_restore",
        failure_reason: "cancelled",
        cancel_reason: cancelReason,
        duration_ms: durationSince(restoreStartedAtRef.current),
        change_kind: restoringActionRef.current || "rollback",
        version_id: restoringVersionIdRef.current,
      });
    }
    controller?.abort();
    activeControllerRef.current = null;
    restoreRequestSequenceRef.current += 1;
    activeStageRef.current = null;
    activeRequestStartedAtRef.current = 0;
    activeRequestKindRef.current = null;
    restoreStartedAtRef.current = 0;
    restoringVersionIdRef.current = "";
    restoringActionRef.current = null;
    if (resetUi) {
      setIsThinking(false);
      setIsRestoringVersion(false);
      setRestoringVersionId("");
      setRestoringAction(null);
      setActiveStage(null);
    }
  }

  function selectSuggestion(suggestion: AIChatSuggestion): void {
    setPrompt(suggestion.label);
    pendingInputSourceRef.current = "suggestion";
    trackAnalyticsEvent("ai_chat_suggestion_selected", {
      ...analyticsBase(),
      suggestion_id: suggestion.id,
    });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function isDiffOpen(messageId: string): boolean {
    return openDiffIds.includes(messageId);
  }

  function toggleDiff(messageId: string): void {
    const opened = !openDiffIds.includes(messageId);
    setOpenDiffIds((current) => opened
      ? [...current, messageId]
      : current.filter((id) => id !== messageId));
    if (!opened && expandedDiffMessageId === messageId) closeExpandedDiff();
    trackAnalyticsEvent("ai_chat_diff_toggled", {
      ...analyticsBase(),
      interaction_state: opened ? "opened" : "closed",
    });
  }

  function openExpandedDiff(messageId: string): void {
    const message = messages.find((item) => item.id === messageId);
    if (!message?.preview) return;
    setExpandedDiffMessageId(messageId);
    setHistoryOpen(false);
    trackAnalyticsEvent("ai_chat_diff_toggled", {
      ...analyticsBase(),
      interaction_state: "shown",
      ui_component: "code_diff_fullscreen",
    });
  }

  function closeExpandedDiff(): void {
    if (!expandedDiffMessageId) return;
    setExpandedDiffMessageId(null);
    trackAnalyticsEvent("ai_chat_diff_toggled", {
      ...analyticsBase(),
      interaction_state: "hidden",
      ui_component: "code_diff_fullscreen",
    });
  }

  function openHistory(): void {
    if (!activeDiagramIdRef.current) return;
    setExpandedDiffMessageId(null);
    setHistoryOpen(true);
    trackAnalyticsEvent("ai_chat_history_opened", {
      ...analyticsBase(),
      version_id: activeVersionIdRef.current,
    });
    if (versionsStatusRef.current === "idle") {
      void loadPersistedVersions(activeDiagramIdRef.current);
    }
  }

  function closeHistory(): void {
    setHistoryOpen(false);
  }

  function handleClose(): void {
    cancelActiveRequest("panel_closed");
    closeExpandedDiff();
    closeHistory();
    onClose();
  }

  function repairSyntax(): void {
    if (isBusy) return;
    trackAnalyticsEvent("ai_chat_syntax_repair_requested", {
      ...analyticsBase(),
      change_kind: "syntax_repair",
    });
    void submitPrompt(
      "syntax_repair",
      "Fix the current syntax issue without changing the rest of the API definition.",
    );
  }

  async function submitPrompt(
    kind: AIChatChangeKind = "request",
    textOverride?: string,
  ): Promise<boolean> {
    const text = (textOverride ?? prompt).trim();
    if (!text || isBusy) return false;

    const previousCode = activeCodeRef.current;
    const startedAt = Date.now();
    const inputSource = kind === "syntax_repair"
      ? "syntax_repair"
      : pendingInputSourceRef.current;
    const retryAfterFailure = lastPromptFailedRef.current;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    activeRequestStartedAtRef.current = startedAt;
    activeRequestKindRef.current = kind;
    setIsThinking(true);
    updateActiveStage(activeDiagramIdRef.current ? "queued" : "ensuring");
    messageCountRef.current = messages.length + 1;
    setMessages((current) => [
      ...current,
      { id: nextMessageId("user"), role: "user", text },
    ]);
    setPrompt("");
    pendingInputSourceRef.current = "typed";
    trackAnalyticsEvent("ai_chat_prompt_submitted", {
      ...analyticsBase(),
      generation_source: kind === "syntax_repair" ? "syntax_repair" : "chat_panel",
      prompt_length: text.length,
      chat_message_count: messages.length + 1,
      turn_index: messages.filter((message) => message.role === "user").length + 1,
      input_source: inputSource,
      retry_after_failure: retryAfterFailure,
      change_kind: kind,
    });
    onSend?.(text);

    try {
      if (activeDiagramIdRef.current && versionsStatusRef.current !== "loaded") {
        await loadPersistedVersions(activeDiagramIdRef.current);
        if (controller.signal.aborted) return false;
      }

      const result = await runAIChatSession({
        diagramId: activeDiagramIdRef.current,
        diagramCode: previousCode,
        diagramType,
        prompt: text,
        title: diagramTitle,
        ...(kind === "syntax_repair" ? { errorMessage: syntaxError } : {}),
        signal: controller.signal,
        onStage(stage) {
          if (activeControllerRef.current === controller) updateActiveStage(stage);
        },
        async onDiagramBound(diagramId) {
          if (activeControllerRef.current !== controller) return;
          activeDiagramIdRef.current = diagramId;
          await onDiagramlyDiagramBound?.(diagramId);
          await loadPersistedVersions(diagramId, true);
        },
      });
      if (activeControllerRef.current !== controller) return false;

      if (result.noChange) {
        activeDiagramIdRef.current = result.diagramId;
        messageCountRef.current += 1;
        setMessages((current) => [
          ...current,
          {
            id: nextMessageId("assistant"),
            role: "assistant",
            text: AI_CHAT_NO_CHANGE_MESSAGE,
          },
        ]);
        lastPromptFailedRef.current = false;
        trackAnalyticsEvent("ai_chat_no_change", {
          ...analyticsBase(),
          generation_source: "chat_panel",
          chat_message_count: messageCountRef.current,
          change_kind: kind,
          duration_ms: durationSince(startedAt),
          poll_count: result.pollCount || 0,
          repair_attempts: result.repairAttempts,
          backend_duration_ms: result.backendDurationMs,
          backend_llm_duration_ms: result.backendLlmDurationMs,
        });
        return true;
      }

      const previousVersionId = activeVersionIdRef.current;
      activeDiagramIdRef.current = result.diagramId;
      activeCodeRef.current = result.updatedCode;
      activeVersionIdRef.current = result.versionId;
      upsertVersion({
        id: result.versionId,
        versionNumber: result.versionNumber || nextVersionNumber(),
        summary: kind === "syntax_repair" ? "Fixed syntax issue" : text,
        detail: kind === "syntax_repair"
          ? "Corrected the syntax issue through AI Chat."
          : `Created from: ${text}`,
        syntaxResolved: kind === "syntax_repair" || !syntaxError,
        time: result.createdAt ? formatVersionTime(result.createdAt) : formatVersionTime(),
        code: result.updatedCode,
      });
      if (versionsStatusRef.current !== "failed") updateVersionsStatus("loaded");
      const preview = createCodePreview(
        diagramTypeLabel,
        kind,
        previousCode,
        result.updatedCode,
      );
      preview.versionId = result.versionId;
      preview.previousVersionId = previousVersionId && previousVersionId !== result.versionId
        ? previousVersionId
        : undefined;
      const message: AIChatMessage = {
        id: nextMessageId("assistant"),
        role: "assistant",
        text: "",
        preview,
      };

      setMessages((current) => [...current, message]);
      messageCountRef.current += 1;
      if (kind === "syntax_repair") setSyntaxResolved(true);
      lastPromptFailedRef.current = false;
      trackAnalyticsEvent("ai_chat_change_applied", {
        ...analyticsBase(),
        chat_message_count: messages.length + 2,
        change_kind: kind,
        version_id: result.versionId,
        version_number: result.versionNumber,
        duration_ms: durationSince(startedAt),
        poll_count: result.pollCount || 0,
        lines_added: preview.diffLines.filter((line) => line.type === "add").length,
        lines_removed: preview.diffLines.filter((line) => line.type === "remove").length,
      });
      onApplyCode?.(result.updatedCode);
      onApply?.(message);
      return true;
    } catch (error) {
      if (
        activeControllerRef.current !== controller
        || (error instanceof Error && error.name === "AbortError")
      ) {
        return false;
      }

      const failure = getAIChatFailureTelemetry(error);
      lastPromptFailedRef.current = true;
      trackAnalyticsEvent("ai_chat_prompt_failed", {
        ...analyticsBase(),
        failure_phase: failure.failurePhase,
        failure_reason: failure.failureReason,
        duration_ms: durationSince(startedAt),
        poll_count: failure.pollCount,
        chat_message_count: messageCountRef.current,
        change_kind: kind,
        generation_source: kind === "syntax_repair" ? "syntax_repair" : "chat_panel",
      });
      const detail = error instanceof Error ? error.message : "Unknown error";
      messageCountRef.current += 1;
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId("assistant"),
          role: "assistant",
          tone: "error",
          text: `AI Chat could not apply the change: ${detail}`,
        },
      ]);
      return false;
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
        setIsThinking(false);
        updateActiveStage(null);
        activeRequestStartedAtRef.current = 0;
        activeRequestKindRef.current = null;
      }
    }
  }

  async function undoPreview(preview: AIChatChangePreview): Promise<void> {
    const targetVersionId = preview.previousVersionId;
    if (!targetVersionId) return;

    const restored = await restoreTargetVersion(targetVersionId, "undo");
    if (restored) {
      setMessages((current) => current.map((message) => (
        message.preview === preview
          ? { ...message, preview: { ...preview, previousVersionId: undefined } }
          : message
      )));
    }
  }

  function restoreVersion(version: AIChatVersion): void {
    if (version.id === activeVersionIdRef.current) return;
    void restoreTargetVersion(version.id, "rollback");
  }

  async function restoreTargetVersion(
    targetVersionId: string,
    kind: "undo" | "rollback",
  ): Promise<boolean> {
    if (!activeDiagramIdRef.current || isBusy) return false;

    const requestId = ++restoreRequestSequenceRef.current;
    const previousCode = activeCodeRef.current;
    const targetVersion = versionsRef.current.find(
      (version) => version.id === targetVersionId,
    );
    setIsRestoringVersion(true);
    setRestoringVersionId(targetVersionId);
    setRestoringAction(kind);
    restoreStartedAtRef.current = Date.now();
    restoringVersionIdRef.current = targetVersionId;
    restoringActionRef.current = kind;
    trackAnalyticsEvent("ai_chat_version_restore_requested", {
      ...analyticsBase(),
      change_kind: kind,
      version_id: targetVersionId,
    });

    try {
      const result = await restoreDiagramlyVersion(
        activeDiagramIdRef.current,
        targetVersionId,
      );
      if (requestId !== restoreRequestSequenceRef.current) return false;

      const restoredVersion = toAIChatVersion(result.version);
      const restoredCode = result.diagramCode ?? result.version.content?.code ?? "";
      if (!restoredCode) {
        throw new Error("Diagramly restored a version without diagram code");
      }

      activeCodeRef.current = restoredCode;
      activeVersionIdRef.current = restoredVersion.id;
      upsertVersion({ ...restoredVersion, code: restoredCode });
      updateVersionsStatus("loaded");
      const message: AIChatMessage = {
        id: nextMessageId("assistant"),
        role: "assistant",
        text: "",
        preview: {
          title: kind === "undo" ? "Changes undone" : "Version restored",
          kind,
          versionId: restoredVersion.id,
          updatedCode: restoredCode,
          items: [
            `Restored v${targetVersion?.versionNumber || "?"} and saved it as v${restoredVersion.versionNumber}.`,
          ],
          diffLocation: `${diagramTypeLabel} diagram`,
          diffLines: buildDiffLines(previousCode, restoredCode),
        },
      };

      setMessages((current) => [...current, message]);
      messageCountRef.current += 1;
      setHistoryOpen(false);
      trackAnalyticsEvent(
        kind === "undo" ? "ai_chat_change_undone" : "ai_chat_version_restored",
        {
          ...analyticsBase(),
          change_kind: kind,
          version_id: targetVersionId,
          version_number: restoredVersion.versionNumber,
          duration_ms: durationSince(restoreStartedAtRef.current),
        },
      );
      onApplyCode?.(restoredCode);
      onApply?.(message);
      return true;
    } catch (error) {
      if (requestId !== restoreRequestSequenceRef.current) return false;
      trackAnalyticsEvent("ai_chat_version_restore_failed", {
        ...analyticsBase(),
        failure_phase: "version_restore",
        failure_reason: error instanceof Error
          && error.message === "Diagramly restored a version without diagram code"
          ? "restored_code_missing"
          : "restore_request_failed",
        duration_ms: durationSince(restoreStartedAtRef.current),
        change_kind: kind,
        version_id: targetVersionId,
      });
      const detail = error instanceof Error ? error.message : "Unknown error";
      messageCountRef.current += 1;
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId("assistant"),
          role: "assistant",
          tone: "error",
          text: `AI Chat could not restore the version: ${detail}`,
        },
      ]);
      return false;
    } finally {
      if (requestId === restoreRequestSequenceRef.current) {
        setIsRestoringVersion(false);
        setRestoringVersionId("");
        setRestoringAction(null);
        restoreStartedAtRef.current = 0;
        restoringVersionIdRef.current = "";
        restoringActionRef.current = null;
      }
    }
  }

  function submitForm(event: FormEvent): void {
    event.preventDefault();
    void submitPrompt();
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitPrompt();
    }
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key !== "Escape") return;
    if (expandedDiffMessageId) {
      closeExpandedDiff();
      return;
    }
    if (historyOpen) {
      closeHistory();
      return;
    }
    handleClose();
  }

  useEffect(() => {
    if (!activeControllerRef.current) activeCodeRef.current = currentCode;
  }, [currentCode]);

  useEffect(() => {
    if (!activeControllerRef.current) {
      const normalizedDiagramId = diagramlyDiagramId.trim();
      if (normalizedDiagramId !== activeDiagramIdRef.current) {
        activeDiagramIdRef.current = normalizedDiagramId;
        activeVersionIdRef.current = "";
        replaceVersions([]);
        versionsDiagramIdRef.current = "";
        updateVersionsStatus("idle");
      }
    }
  }, [diagramlyDiagramId]);

  useEffect(() => {
    if (
      open
      && activeDiagramIdRef.current
      && versionsStatusRef.current === "idle"
    ) {
      void loadPersistedVersions(activeDiagramIdRef.current);
    }
  }, [diagramlyDiagramId, open]);

  useEffect(() => {
    if (syntaxError) setSyntaxResolved(false);
  }, [syntaxError]);

  useEffect(() => {
    const latestMessage = messages[messages.length - 1];
    const content = contentRef.current;
    if (!open || latestMessage?.role !== "user" || !content) return;

    content.scrollTop = content.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (!open || !visibleSyntaxError || !syntaxError) {
      lastTrackedSyntaxIssueRef.current = "";
      return;
    }
    if (lastTrackedSyntaxIssueRef.current === syntaxError) return;
    lastTrackedSyntaxIssueRef.current = syntaxError;
    trackAnalyticsEvent("ai_chat_syntax_issue_shown", {
      ...analyticsBase(),
      error_category: "syntax_error",
      ui_component: "syntax_issue_banner",
    });
  }, [open, syntaxError, visibleSyntaxError]);

  useEffect(() => {
    if (
      !open
      || !syntaxRepairRequestId
      || syntaxRepairRequestId === lastHandledSyntaxRepairRequestIdRef.current
      || !syntaxError
      || isBusy
    ) {
      return;
    }

    lastHandledSyntaxRepairRequestIdRef.current = syntaxRepairRequestId;
    repairSyntax();
  }, [isBusy, open, syntaxError, syntaxRepairRequestId]);

  useEffect(() => {
    if (!open) {
      cancelActiveRequest("panel_closed");
      closeExpandedDiff();
      closeHistory();
    }
  }, [open]);

  useEffect(() => () => {
    cancelActiveRequest("component_unmounted", false);
    versionsRequestSequenceRef.current += 1;
  }, []);

  if (!open) return null;

  return (
    <aside
      className="ai-chat-panel"
      aria-label="AI OpenAPI assistant"
      data-testid="react-ai-chat-panel"
      onKeyDown={handlePanelKeyDown}
    >
      <header className="ai-chat-header">
        <div className="ai-chat-head-row">
          <div className="ai-chat-title">
            <span className="ai-chat-title-icon" aria-hidden="true">
              <AIChatIcon name="sparkles" />
            </span>
            <span>
              <strong>AI chat</strong>
              <small>{diagramTypeLabel} assistant</small>
            </span>
          </div>
          <div className="ai-chat-head-actions">
            {onToggleCode && (
              <button
                type="button"
                className="ai-chat-code-button"
                aria-label={codeVisible ? "Hide code editor" : "Show code editor"}
                aria-pressed={codeVisible}
                title={codeVisible ? "Hide code editor" : "Show code editor"}
                data-testid="react-ai-chat-code-toggle"
                onClick={() => {
                  trackAnalyticsEvent("ai_chat_code_visibility_toggled", {
                    ...analyticsBase(),
                    interaction_state: codeVisible ? "hidden" : "shown",
                  });
                  onToggleCode();
                }}
              >
                <AIChatIcon name="code" />
                <span>{codeVisible ? "Hide code" : "Show code"}</span>
              </button>
            )}
            <button
              type="button"
              className="ai-chat-icon-button"
              aria-label="Close AI chat"
              title="Close AI chat"
              data-testid="react-ai-chat-close"
              onClick={handleClose}
            >
              <AIChatIcon name="close" />
            </button>
          </div>
        </div>

        {visibleSyntaxError && (
          <div
            className="ai-chat-syntax"
            role="status"
            data-testid="react-ai-chat-syntax-issue"
          >
            <div className="ai-chat-syntax-message">
              <AIChatIcon name="warning" />
              <span>
                <strong>Syntax issue</strong>
                <span>{syntaxErrorSummary}</span>
              </span>
            </div>
            <button
              type="button"
              data-testid="react-ai-chat-auto-fix"
              disabled={isBusy}
              onClick={repairSyntax}
            >
              Fix syntax
            </button>
          </div>
        )}
      </header>

      <main ref={contentRef} className="ai-chat-content">
        {messages.length === 0 && !isThinking ? (
          <section className="ai-chat-empty" data-testid="react-ai-chat-empty-state">
            <div className="ai-chat-empty-intro">
              <span className="ai-chat-empty-icon" aria-hidden="true">
                <AIChatIcon name="sparkles" />
              </span>
              <div>
                <h3>What would you like to change?</h3>
                <p>Describe an edit or start with a suggestion.</p>
              </div>
            </div>
            <p className="ai-chat-section-label">Suggested edits</p>
            {AI_CHAT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="ai-chat-quick-button"
                data-testid={`react-ai-chat-suggestion-${suggestion.id}`}
                title={suggestion.description}
                onClick={() => selectSuggestion(suggestion)}
              >
                <span className="ai-chat-quick-copy">
                  <strong>{suggestion.label}</strong>
                  <span>{suggestion.description}</span>
                </span>
                <AIChatIcon name="arrow" />
              </button>
            ))}
          </section>
        ) : (
          <section className="ai-chat-conversation" data-testid="react-ai-chat-conversation">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`ai-chat-turn is-${message.role}${
                  message.tone ? ` is-${message.tone}` : ""
                }`}
                data-testid="react-ai-chat-message"
              >
                {message.text && <p>{message.text}</p>}
                {message.preview && (
                  <div className="ai-chat-preview" data-testid="react-ai-change-preview">
                    <div className="ai-chat-preview-header">
                      <span className="ai-chat-preview-title">
                        <span aria-hidden="true"><AIChatIcon name="check" /></span>
                        <strong>{message.preview.title}</strong>
                      </span>
                      {message.preview.previousVersionId && (
                        <button
                          type="button"
                          data-testid="react-ai-chat-undo"
                          disabled={isBusy}
                          onClick={() => void undoPreview(message.preview!)}
                        >
                          <AIChatIcon name="undo" />
                          {restoringAction === "undo" ? "Undoing…" : "Undo"}
                        </button>
                      )}
                    </div>
                    <ul>
                      {message.preview.items.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                    <button
                      type="button"
                      className="ai-chat-diff-toggle"
                      aria-expanded={isDiffOpen(message.id)}
                      onClick={() => toggleDiff(message.id)}
                    >
                      <span>{isDiffOpen(message.id) ? "Hide code diff" : "View code diff"}</span>
                      <AIChatIcon name={isDiffOpen(message.id) ? "chevron-up" : "chevron-down"} />
                    </button>
                    {isDiffOpen(message.id) && (
                      <div className="ai-chat-diff" data-testid="react-ai-chat-diff">
                        <div className="ai-chat-diff-header">
                          <span>
                            <strong>Code diff</strong>
                            <span>{message.preview.diffLocation}</span>
                          </span>
                          <button
                            type="button"
                            aria-label="Expand code diff"
                            data-testid="react-ai-chat-diff-expand"
                            onClick={() => openExpandedDiff(message.id)}
                          >
                            <AIChatIcon name="expand" />
                            Expand
                          </button>
                        </div>
                        {message.preview.diffLines.map((line, index) => (
                          <div
                            key={`${message.id}-${index}`}
                            className={`ai-chat-diff-line is-${line.type}`}
                          >
                            <span aria-hidden="true">
                              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                            </span>
                            <code>{line.code}</code>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}

            {isBusy && (
              <article
                className="ai-chat-progress"
                role="status"
                aria-live="polite"
                data-testid="react-ai-chat-thinking"
              >
                {isRestoringVersion ? (
                  <p>Restoring version...</p>
                ) : (
                  <ol>
                    {stages.map((stage, index) => (
                      <li
                        key={stage.key}
                        className={
                          index < activeStageIndex
                            ? "is-complete"
                            : index === activeStageIndex
                              ? "is-active"
                              : "is-pending"
                        }
                      >
                        <span className="ai-chat-stage-marker" aria-hidden="true">
                          {index < activeStageIndex ? (
                            <AIChatIcon name="check" />
                          ) : index === activeStageIndex ? (
                            <AIChatIcon name="spinner" className="ai-chat-spin" />
                          ) : (
                            <span>{index + 1}</span>
                          )}
                        </span>
                        <strong>{stage.label}</strong>
                      </li>
                    ))}
                  </ol>
                )}
              </article>
            )}
          </section>
        )}
      </main>

      {expandedDiffPreview && (
        <section
          className="ai-chat-diff-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="Expanded code diff"
          data-testid="react-ai-chat-diff-fullscreen"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeExpandedDiff();
          }}
        >
          <div className="ai-chat-diff-fullscreen-panel">
            <header>
              <span>
                <strong>Code diff</strong>
                <span>{expandedDiffPreview.diffLocation}</span>
              </span>
              <button
                type="button"
                aria-label="Close expanded code diff"
                data-testid="react-ai-chat-diff-fullscreen-close"
                onClick={closeExpandedDiff}
              >
                <AIChatIcon name="close" />
              </button>
            </header>
            <div className="ai-chat-diff-code">
              {expandedDiffPreview.diffLines.map((line, index) => (
                <div
                  key={`expanded-${expandedDiffMessageId}-${index}`}
                  className={`ai-chat-diff-line is-${line.type}`}
                >
                  <span aria-hidden="true">
                    {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                  </span>
                  <code>{line.code}</code>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {historyOpen && (
        <section
          className="ai-chat-history-panel"
          role="region"
          aria-label="Diagram versions"
          data-testid="react-ai-chat-history-panel"
        >
          <header>
            <button
              type="button"
              className="ai-chat-history-back"
              aria-label="Back to AI chat"
              title="Back to AI chat"
              onClick={closeHistory}
            >
              <AIChatIcon name="back" />
            </button>
            <div className="ai-chat-history-title">
              <span>
                <h3>Diagram versions</h3>
                <p>Review or restore a saved change.</p>
              </span>
            </div>
          </header>
          {versionsStatus === "loading" ? (
            <div role="status" data-testid="react-ai-chat-history-loading">
              Loading saved versions...
            </div>
          ) : versionsStatus === "failed" ? (
            <div role="status" data-testid="react-ai-chat-history-error">
              <p>Saved versions could not be loaded.</p>
              <button
                type="button"
                data-testid="react-ai-chat-history-retry"
                onClick={retryLoadVersions}
              >
                Retry
              </button>
            </div>
          ) : reversedVersions.length === 0 ? (
            <p>No saved versions yet.</p>
          ) : (
            <ol className="ai-chat-history-list">
              {reversedVersions.map((version) => (
                <li
                  key={version.id}
                  className={`ai-chat-history-item${
                    version.id === activeVersionIdRef.current ? " is-current" : ""
                  }`}
                >
                  <div>
                    <p>
                      <strong>v{version.versionNumber}</strong>
                      <span>{version.summary}</span>
                    </p>
                    <p>{version.detail}</p>
                    <small>{version.time}</small>
                  </div>
                  <button
                    type="button"
                    className="ai-chat-rollback"
                    disabled={version.id === activeVersionIdRef.current || isBusy}
                    onClick={() => restoreVersion(version)}
                  >
                    {version.id === activeVersionIdRef.current
                      ? "Current"
                      : restoringVersionId === version.id
                        ? "Restoring..."
                        : "Restore version"}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <form className="ai-chat-composer" onSubmit={submitForm}>
        <div className="ai-chat-composer-field">
          <textarea
            ref={inputRef}
            value={prompt}
            rows={2}
            placeholder="Describe the API definition change…"
            aria-label="AI change request"
            data-testid="react-ai-chat-input"
            disabled={isRestoringVersion}
            onChange={(event) => {
              pendingInputSourceRef.current = "typed";
              setPrompt(event.target.value);
            }}
            onKeyDown={handleInputKeyDown}
          />
          <div className="ai-chat-composer-hint" aria-hidden="true">
            <span>Enter to send</span>
            <span>Shift + Enter for a new line</span>
          </div>
        </div>
        <div className="ai-chat-composer-actions">
          <button
            type="button"
            className="ai-chat-history-trigger"
            aria-label="Open diagram versions"
            data-testid="react-ai-chat-history-trigger"
            aria-expanded={historyOpen}
            disabled={!activeDiagramIdRef.current}
            onClick={openHistory}
          >
            <AIChatIcon name="clock" />
            <span>Versions</span>
            <span className="ai-chat-count">{versionCountLabel}</span>
          </button>
          <button
            type="submit"
            className="ai-chat-send-button"
            aria-label="Send message"
            data-testid="react-ai-chat-send"
            disabled={!canSubmit}
          >
            <AIChatIcon name="send" />
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
