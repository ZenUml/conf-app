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
  runAIChatSession,
  type AIChatSessionStage,
} from "@/services/AIChatSessionService";
import {
  getDiagramlyVersions,
  restoreDiagramlyVersion,
  type DiagramlyVersion,
} from "@/services/GenerateService";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import type { MacroTypeValue } from "@/utils/analytics/catalog";

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
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const activeDiagramIdRef = useRef(diagramlyDiagramId.trim());
  const activeCodeRef = useRef(currentCode);
  const activeVersionIdRef = useRef("");
  const versionsRef = useRef<AIChatVersion[]>([]);
  const versionsStatusRef = useRef<"idle" | "loading" | "loaded" | "failed">("idle");
  const versionsDiagramIdRef = useRef("");
  const versionsRequestSequenceRef = useRef(0);
  const versionLoadPromiseRef = useRef<Promise<void> | null>(null);
  const restoreRequestSequenceRef = useRef(0);
  const lastHandledSyntaxRepairRequestIdRef = useRef(0);
  const messageSequenceRef = useRef(0);

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
      } catch {
        if (
          requestId === versionsRequestSequenceRef.current
          && activeDiagramIdRef.current === diagramId
        ) {
          updateVersionsStatus("failed");
        }
      }
    })();

    versionLoadPromiseRef.current = request;
    await request;
    if (versionLoadPromiseRef.current === request) versionLoadPromiseRef.current = null;
  }

  function retryLoadVersions(): void {
    void loadPersistedVersions(activeDiagramIdRef.current, true);
  }

  function cancelActiveRequest(): void {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    restoreRequestSequenceRef.current += 1;
    setIsThinking(false);
    setIsRestoringVersion(false);
    setRestoringVersionId("");
    setRestoringAction(null);
    setActiveStage(null);
  }

  function selectSuggestion(suggestion: AIChatSuggestion): void {
    setPrompt(suggestion.label);
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
    cancelActiveRequest();
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
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setIsThinking(true);
    setActiveStage(activeDiagramIdRef.current ? "queued" : "ensuring");
    setMessages((current) => [
      ...current,
      { id: nextMessageId("user"), role: "user", text },
    ]);
    setPrompt("");
    trackAnalyticsEvent("ai_chat_prompt_submitted", {
      ...analyticsBase(),
      generation_source: kind === "syntax_repair" ? "syntax_repair" : "chat_panel",
      prompt_length: text.length,
      chat_message_count: messages.length + 1,
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
          if (activeControllerRef.current === controller) setActiveStage(stage);
        },
        async onDiagramBound(diagramId) {
          if (activeControllerRef.current !== controller) return;
          activeDiagramIdRef.current = diagramId;
          await onDiagramlyDiagramBound?.(diagramId);
          await loadPersistedVersions(diagramId, true);
        },
      });
      if (activeControllerRef.current !== controller) return false;

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
      if (kind === "syntax_repair") setSyntaxResolved(true);
      trackAnalyticsEvent("ai_chat_change_applied", {
        ...analyticsBase(),
        chat_message_count: messages.length + 2,
        change_kind: kind,
        version_id: result.versionId,
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

      const detail = error instanceof Error ? error.message : "Unknown error";
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId("assistant"),
          role: "assistant",
          text: `AI Chat could not apply the change: ${detail}`,
        },
      ]);
      return false;
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null;
        setIsThinking(false);
        setActiveStage(null);
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
      setHistoryOpen(false);
      trackAnalyticsEvent(
        kind === "undo" ? "ai_chat_change_undone" : "ai_chat_version_restored",
        {
          ...analyticsBase(),
          change_kind: kind,
          version_id: targetVersionId,
        },
      );
      onApplyCode?.(restoredCode);
      onApply?.(message);
      return true;
    } catch (error) {
      if (requestId !== restoreRequestSequenceRef.current) return false;
      const detail = error instanceof Error ? error.message : "Unknown error";
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId("assistant"),
          role: "assistant",
          text: `AI Chat could not restore the version: ${detail}`,
        },
      ]);
      return false;
    } finally {
      if (requestId === restoreRequestSequenceRef.current) {
        setIsRestoringVersion(false);
        setRestoringVersionId("");
        setRestoringAction(null);
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
      cancelActiveRequest();
      closeExpandedDiff();
      closeHistory();
    }
  }, [open]);

  useEffect(() => () => {
    activeControllerRef.current?.abort();
    versionsRequestSequenceRef.current += 1;
    restoreRequestSequenceRef.current += 1;
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
          <strong>AI Chat</strong>
          <div className="ai-chat-head-actions">
            {onToggleCode && (
              <button
                type="button"
                aria-label={codeVisible ? "Hide code editor" : "Show code editor"}
                aria-pressed={codeVisible}
                data-testid="react-ai-chat-code-toggle"
                onClick={() => {
                  trackAnalyticsEvent("ai_chat_code_visibility_toggled", {
                    ...analyticsBase(),
                    interaction_state: codeVisible ? "hidden" : "shown",
                  });
                  onToggleCode();
                }}
              >
                {codeVisible ? "Hide code" : "Show code"}
              </button>
            )}
            <button
              type="button"
              aria-label="Close AI chat"
              data-testid="react-ai-chat-close"
              onClick={handleClose}
            >
              Close
            </button>
          </div>
        </div>

        {visibleSyntaxError && (
          <div
            className="ai-chat-syntax"
            role="status"
            data-testid="react-ai-chat-syntax-issue"
          >
            <span>{syntaxErrorSummary}</span>
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

      <main className="ai-chat-content">
        {messages.length === 0 && !isThinking ? (
          <section className="ai-chat-empty" data-testid="react-ai-chat-empty-state">
            <h3>What should change?</h3>
            <p>Suggested edits</p>
            {AI_CHAT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion.id}
                type="button"
                className="ai-chat-quick-button"
                data-testid={`react-ai-chat-suggestion-${suggestion.id}`}
                title={suggestion.description}
                onClick={() => selectSuggestion(suggestion)}
              >
                <strong>{suggestion.label}</strong>
                <span>{suggestion.description}</span>
              </button>
            ))}
          </section>
        ) : (
          <section className="ai-chat-conversation" data-testid="react-ai-chat-conversation">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`ai-chat-turn is-${message.role}`}
                data-testid="react-ai-chat-message"
              >
                {message.text && <p>{message.text}</p>}
                {message.preview && (
                  <div className="ai-chat-preview" data-testid="react-ai-change-preview">
                    <div className="ai-chat-preview-header">
                      <strong>{message.preview.title}</strong>
                      {message.preview.previousVersionId && (
                        <button
                          type="button"
                          data-testid="react-ai-chat-undo"
                          disabled={isBusy}
                          onClick={() => void undoPreview(message.preview!)}
                        >
                          {restoringAction === "undo" ? "Undoing..." : "Undo"}
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
                      {isDiffOpen(message.id) ? "Hide code diff" : "View code diff"}
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
                        <span aria-hidden="true">{index + 1}</span>
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
                Close
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
            <h3>Diagram versions</h3>
            <button type="button" aria-label="Close diagram versions" onClick={closeHistory}>
              Close
            </button>
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
        <textarea
          ref={inputRef}
          value={prompt}
          rows={2}
          placeholder="Describe the API definition change..."
          aria-label="AI change request"
          data-testid="react-ai-chat-input"
          disabled={isRestoringVersion}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />
        <button
          type="button"
          aria-label="Open diagram versions"
          data-testid="react-ai-chat-history-trigger"
          aria-expanded={historyOpen}
          disabled={!activeDiagramIdRef.current}
          onClick={openHistory}
        >
          Diagram versions <span>{versionCountLabel}</span>
        </button>
        <button
          type="submit"
          aria-label="Send message"
          data-testid="react-ai-chat-send"
          disabled={!canSubmit}
        >
          Send
        </button>
      </form>
    </aside>
  );
}
