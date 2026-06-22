import React, {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ArrowRightIcon from "@atlaskit/icon/glyph/arrow-right";
import CheckCircleIcon from "@atlaskit/icon/glyph/check-circle";
import CheckIcon from "@atlaskit/icon/glyph/check";
import ChevronDownIcon from "@atlaskit/icon/glyph/chevron-down";
import ClockIcon from "@atlaskit/icon/glyph/recent";
import CodeIcon from "@atlaskit/icon/glyph/code";
import CrossIcon from "@atlaskit/icon/glyph/cross";
import ErrorIcon from "@atlaskit/icon/glyph/error";
import SendIcon from "@atlaskit/icon/glyph/send";
import StarIcon from "@atlaskit/icon/glyph/star";
import FullScreenOnIcon from "@atlaskit/icon/glyph/vid-full-screen-on";
import {
  AI_CHAT_SUGGESTIONS,
  createCodePreview,
  createPrototypePreview,
  formatVersionTime,
  type AIChatChangeKind,
  type AIChatChangePreview,
  type AIChatMessage,
  type AIChatSuggestion,
  type AIChatVersion,
} from "@/components/AIChat/aiChatPrototype";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import {
  getDiagramlyJobStatus,
  startDiagramChatModification,
  type DiagramlyJobStatus,
} from "@/services/GenerateService";
import "@/assets/ai-chat.css";

export type { AIChatMessage };

interface Props {
  open: boolean;
  codeVisible?: boolean;
  diagramType?: string;
  syntaxError?: string;
  syntaxRepairRequestId?: number;
  prototypeMode?: boolean;
  currentCode?: string;
  initialMessages?: AIChatMessage[];
  onClose: () => void;
  onToggleCode?: () => void;
  onSend?: (prompt: string) => void;
  onApply?: (message: AIChatMessage) => void;
  onApplyCode?: (code: string) => void;
}

const stages = ["Understanding request", "Updating diagram", "Syncing changes"];
const completedStages = ["Understood", "Updated", "Synced"];

function icon(icon: React.ReactNode) {
  return <span aria-hidden="true">{icon}</span>;
}

export default function AIChatPanel({
  open,
  codeVisible = false,
  diagramType = "openapi",
  syntaxError = "",
  syntaxRepairRequestId = 0,
  prototypeMode = false,
  currentCode = "",
  initialMessages = [],
  onClose,
  onToggleCode,
  onSend,
  onApply,
  onApplyCode,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AIChatMessage[]>(() =>
    initialMessages.map((message) => ({ ...message })),
  );
  const [isThinking, setIsThinking] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);
  const [syntaxDetailsOpen, setSyntaxDetailsOpen] = useState(false);
  const [syntaxResolved, setSyntaxResolved] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openDiffIds, setOpenDiffIds] = useState<string[]>([]);
  const [expandedDiffMessageId, setExpandedDiffMessageId] = useState<string | null>(null);
  const [versions, setVersions] = useState<AIChatVersion[]>([
    {
      id: 1,
      summary: "Initial version",
      detail: "Diagram state before the current AI Chat session.",
      syntaxResolved: !syntaxError,
      time: formatVersionTime(),
      code: currentCode,
    },
  ]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const lastHandledSyntaxRepairRequestId = useRef(0);
  const activeRequestId = useRef(0);

  const diagramTypeLabel = useMemo(() => {
    const labels: Record<string, string> = {
      sequence: "Sequence",
      mermaid: "Mermaid",
      plantuml: "PlantUML",
      graph: "Graph",
      openapi: "OpenAPI",
    };
    return labels[diagramType.toLowerCase()] || "Current";
  }, [diagramType]);

  const currentVersionId = versions[versions.length - 1]?.id || 0;
  const visibleSyntaxError = Boolean(syntaxError) && !syntaxResolved;
  const expandedDiffPreview = useMemo(
    () => messages.find((message) => message.id === expandedDiffMessageId)?.preview || null,
    [expandedDiffMessageId, messages],
  );
  const overlayOpen = historyOpen || Boolean(expandedDiffPreview);

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [messages, isThinking, stageIndex]);

  useEffect(() => {
    return () => {
      activeRequestId.current += 1;
      timersRef.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    setVersions((current) => {
      if (current.length !== 1) return current;
      const [first] = current;
      if (first.code === currentCode) return current;
      return [{ ...first, code: currentCode }];
    });
  }, [currentCode]);

  useEffect(() => {
    setSyntaxResolved(false);
    setSyntaxDetailsOpen(false);
  }, [syntaxError]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const analyticsBase = () => ({
    feature_area: "ai" as const,
    surface: "editor" as const,
    macro_type: "openapi" as const,
  });

  const focusInput = () => {
    setHistoryOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selectSuggestion = (suggestion: AIChatSuggestion) => {
    setPrompt(suggestion.label);
    trackAnalyticsEvent("ai_chat_suggestion_selected", {
      ...analyticsBase(),
      suggestion_id: suggestion.id,
    });
    focusInput();
  };

  const addVersion = (
    summary: string,
    detail: string,
    resolved: boolean,
    code?: string,
  ): AIChatVersion => {
    const version: AIChatVersion = {
      id: currentVersionId + 1,
      summary,
      detail,
      syntaxResolved: resolved,
      time: formatVersionTime(),
      code,
    };
    setVersions((current) => [...current, version]);
    return version;
  };

  const completePrototypeRequest = (kind: AIChatChangeKind) => {
    const previousVersionId = currentVersionId;
    const preview = createPrototypePreview(diagramTypeLabel, kind, syntaxResolved);
    const nextVersion = addVersion(
      kind === "syntax_repair" ? "Fixed syntax issue" : "Updated diagram flow",
      kind === "syntax_repair"
        ? "Corrected the invalid syntax and synchronized the preview."
        : "Applied the requested change and synchronized the preview.",
      true,
    );
    preview.versionId = nextVersion.id;
    preview.previousVersionId = previousVersionId;

    const message: AIChatMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      text: "",
      preview,
    };
    setMessages((current) => [...current, message]);
    setSyntaxResolved(true);
    setSyntaxDetailsOpen(false);
    setIsThinking(false);
    trackAnalyticsEvent("ai_chat_change_applied", {
      ...analyticsBase(),
      chat_message_count: messages.length + 2,
      change_kind: kind,
      version_id: nextVersion.id,
    });
    onApply?.(message);
  };

  const updateStageFromJob = (job: DiagramlyJobStatus) => {
    if (job.status === "GENERATING") {
      setStageIndex(2);
      return;
    }
    if (job.status === "PROCESSING") {
      setStageIndex(1);
    }
  };

  const handleDiagramlyError = (error: unknown, requestId: number) => {
    if (activeRequestId.current !== requestId) return;
    const text = error instanceof Error ? error.message : String(error || "Diagram update failed");
    setMessages((current) => [
      ...current,
      { id: `assistant-error-${Date.now()}`, role: "assistant", text },
    ]);
    setIsThinking(false);
    setStageIndex(0);
  };

  const completeDiagramlyRequest = (
    kind: AIChatChangeKind,
    previousCode: string,
    updatedCode: string,
  ) => {
    const previousVersionId = currentVersionId;
    const preview = createCodePreview(diagramTypeLabel, kind, previousCode, updatedCode);
    const nextVersion = addVersion(
      kind === "syntax_repair" ? "Fixed syntax issue" : "Updated diagram flow",
      kind === "syntax_repair"
        ? "Corrected the invalid syntax and synchronized the preview."
        : "Applied the requested change and synchronized the preview.",
      true,
      updatedCode,
    );
    preview.versionId = nextVersion.id;
    preview.previousVersionId = previousVersionId;

    const message: AIChatMessage = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      text: "",
      preview,
    };
    setMessages((current) => [...current, message]);
    setSyntaxResolved(true);
    setSyntaxDetailsOpen(false);
    setIsThinking(false);
    setStageIndex(0);
    trackAnalyticsEvent("ai_chat_change_applied", {
      ...analyticsBase(),
      chat_message_count: messages.length + 2,
      change_kind: kind,
      version_id: nextVersion.id,
    });
    onApplyCode?.(updatedCode);
    onApply?.(message);
  };

  const pollDiagramlyJob = (
    jobId: string,
    requestId: number,
    kind: AIChatChangeKind,
    previousCode: string,
    attempts = 0,
  ) => {
    if (activeRequestId.current !== requestId) return;

    getDiagramlyJobStatus(jobId)
      .then((job) => {
        if (activeRequestId.current !== requestId) return;
        updateStageFromJob(job);

        if (job.status === "COMPLETED") {
          const updatedCode = job.output?.diagramCode;
          if (!updatedCode) {
            throw new Error("Job completed but no diagram code was returned");
          }
          completeDiagramlyRequest(kind, previousCode, updatedCode);
          return;
        }

        if (job.status === "FAILED" || job.status === "CANCELLED") {
          throw new Error(job.error || job.message || `Diagram update ${job.status.toLowerCase()}`);
        }

        if (attempts >= 30) {
          throw new Error("Diagram update timed out after 60 seconds");
        }

        timersRef.current.push(
          setTimeout(() => pollDiagramlyJob(jobId, requestId, kind, previousCode, attempts + 1), 2000),
        );
      })
      .catch((error) => handleDiagramlyError(error, requestId));
  };

  const runDiagramlyRequest = (text: string, kind: AIChatChangeKind) => {
    const requestId = activeRequestId.current + 1;
    activeRequestId.current = requestId;
    const previousCode = currentCode;

    setIsThinking(true);
    setStageIndex(0);

    startDiagramChatModification({
      diagramCode: previousCode,
      prompt: text,
      diagramType,
      errorMessage: kind === "syntax_repair" ? syntaxError : undefined,
    })
      .then(({ jobId }) => {
        if (activeRequestId.current !== requestId) return;
        setStageIndex(1);
        pollDiagramlyJob(jobId, requestId, kind, previousCode);
      })
      .catch((error) => handleDiagramlyError(error, requestId));
  };

  const runPrompt = (text: string, kind: AIChatChangeKind = "request") => {
    if (!text || isThinking) return;

    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", text },
    ]);
    setPrompt("");
    setHistoryOpen(false);

    trackAnalyticsEvent("ai_chat_prompt_submitted", {
      ...analyticsBase(),
      generation_source: kind === "syntax_repair" ? "syntax_repair" : "chat_panel",
      prompt_length: text.length,
      chat_message_count: messages.length + 1,
      change_kind: kind,
    });
    onSend?.(text);

    if (prototypeMode) {
      setIsThinking(true);
      setStageIndex(0);
      timersRef.current = [
        setTimeout(() => setStageIndex(1), 350),
        setTimeout(() => setStageIndex(2), 700),
        setTimeout(() => completePrototypeRequest(kind), 1050),
      ];
      return;
    }

    runDiagramlyRequest(text, kind);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitPrompt();
    }
  };

  const submitPrompt = (event?: FormEvent, kind: AIChatChangeKind = "request") => {
    event?.preventDefault();
    runPrompt(prompt.trim(), kind);
  };

  const closeExpandedDiff = () => {
    if (!expandedDiffMessageId) return;
    setExpandedDiffMessageId(null);
    trackAnalyticsEvent("ai_chat_diff_toggled", {
      ...analyticsBase(),
      interaction_state: "hidden",
      ui_component: "code_diff_fullscreen",
    });
  };

  const toggleDiff = (messageId: string) => {
    const opened = !openDiffIds.includes(messageId);
    setOpenDiffIds((current) =>
      opened ? [...current, messageId] : current.filter((id) => id !== messageId),
    );
    if (!opened && expandedDiffMessageId === messageId) {
      closeExpandedDiff();
    }
    trackAnalyticsEvent("ai_chat_diff_toggled", {
      ...analyticsBase(),
      interaction_state: opened ? "opened" : "closed",
    });
  };

  const openExpandedDiff = (messageId: string) => {
    if (!messages.some((message) => message.id === messageId && message.preview)) return;
    setExpandedDiffMessageId(messageId);
    setHistoryOpen(false);
    setSyntaxDetailsOpen(false);
    trackAnalyticsEvent("ai_chat_diff_toggled", {
      ...analyticsBase(),
      interaction_state: "shown",
      ui_component: "code_diff_fullscreen",
    });
  };

  const undoPreview = (preview: AIChatChangePreview) => {
    const targetId = preview.previousVersionId;
    if (!targetId) return;
    const target = versions.find((version) => version.id === targetId);
    if (!target) return;

    preview.previousVersionId = undefined;
    setSyntaxResolved(target.syntaxResolved);
    const restored = addVersion(
      `Undo to v${target.id}`,
      `Restored the diagram state from ${target.summary}.`,
      target.syntaxResolved,
      target.code,
    );
    setMessages((current) => [
      ...current,
      {
        id: `assistant-undo-${Date.now()}`,
        role: "assistant",
        text: "",
        preview: {
          title: "Changes undone",
          kind: "undo",
          versionId: restored.id,
          items: [`Restored v${target.id} and saved the result as v${restored.id}.`],
          diffLocation: "Complete diagram version",
          diffLines: [{ type: "context", code: `Restored v${target.id}: ${target.summary}` }],
        },
      },
    ]);
    if (target.code !== undefined) {
      onApplyCode?.(target.code);
    }
    trackAnalyticsEvent("ai_chat_change_undone", {
      ...analyticsBase(),
      change_kind: "undo",
      version_id: target.id,
    });
  };

  const restoreVersion = (version: AIChatVersion) => {
    if (version.id === currentVersionId) return;
    setSyntaxResolved(version.syntaxResolved);
    const restored = addVersion(
      `Restored v${version.id}`,
      `Restored the complete diagram state from ${version.summary}.`,
      version.syntaxResolved,
      version.code,
    );
    setMessages((current) => [
      ...current,
      {
        id: `assistant-restore-${Date.now()}`,
        role: "assistant",
        text: "",
        preview: {
          title: "Version restored",
          kind: "rollback",
          versionId: restored.id,
          items: [`Restored v${version.id} and saved the result as v${restored.id}.`],
          diffLocation: "Complete diagram version",
          diffLines: [{ type: "context", code: `Restored v${version.id}: ${version.summary}` }],
        },
      },
    ]);
    setHistoryOpen(false);
    if (version.code !== undefined) {
      onApplyCode?.(version.code);
    }
    trackAnalyticsEvent("ai_chat_version_restored", {
      ...analyticsBase(),
      change_kind: "rollback",
      version_id: version.id,
    });
  };

  const repairSyntax = () => {
    if (isThinking) return;
    const repairText = "Fix the current syntax issue without changing the rest of the diagram.";
    setSyntaxDetailsOpen(false);
    trackAnalyticsEvent("ai_chat_syntax_repair_requested", {
      ...analyticsBase(),
      change_kind: "syntax_repair",
    });
    runPrompt(repairText, "syntax_repair");
  };

  useEffect(() => {
    if (
      !open ||
      !syntaxRepairRequestId ||
      syntaxRepairRequestId === lastHandledSyntaxRepairRequestId.current
    ) {
      return;
    }
    lastHandledSyntaxRepairRequestId.current = syntaxRepairRequestId;
    repairSyntax();
  }, [open, syntaxRepairRequestId]);

  const closePanel = () => {
    setExpandedDiffMessageId(null);
    setHistoryOpen(false);
    setSyntaxDetailsOpen(false);
    onClose();
  };

  const handleEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    if (expandedDiffPreview) {
      closeExpandedDiff();
      return;
    }
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    if (syntaxDetailsOpen) {
      setSyntaxDetailsOpen(false);
      return;
    }
    closePanel();
  };

  if (!open) return null;

  return (
    <aside
      className="ai-chat-panel"
      aria-label="AI diagram assistant"
      data-testid="react-ai-chat-panel"
      onKeyDown={handleEscape}
    >
      <header className="ai-chat-header">
        <div className="ai-chat-head-row" data-testid="react-ai-chat-header-row">
          <div className="ai-chat-identity">
            <span className="ai-chat-identity-icon">
              {icon(<StarIcon label="" size="small" primaryColor="currentColor" />)}
            </span>
            <span className="ai-chat-identity-label">AI</span>
            {visibleSyntaxError && (
              <button
                type="button"
                className="ai-chat-syntax"
                aria-label="Show 1 syntax issue"
                aria-expanded={syntaxDetailsOpen}
                data-testid="react-ai-chat-syntax-indicator"
                onClick={(event) => {
                  event.stopPropagation();
                  const opened = !syntaxDetailsOpen;
                  setSyntaxDetailsOpen(opened);
                  trackAnalyticsEvent("ai_chat_syntax_details_toggled", {
                    ...analyticsBase(),
                    interaction_state: opened ? "opened" : "closed",
                  });
                }}
              >
                {icon(<ErrorIcon label="" size="small" primaryColor="currentColor" />)}
                <span>Syntax</span>
                <span className="ai-chat-syntax-count">1</span>
              </button>
            )}
          </div>

          <div className="ai-chat-head-actions">
            {onToggleCode && (
              <button
                type="button"
                className="ai-chat-head-button"
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
                {icon(<CodeIcon label="" size="small" primaryColor="currentColor" />)}
                <span>{codeVisible ? "Hide code" : "Show code"}</span>
              </button>
            )}
            <button
              type="button"
              className="ai-chat-head-button ai-chat-close"
              aria-label="Close AI chat"
              data-testid="react-ai-chat-close"
              onClick={closePanel}
            >
              {icon(<CrossIcon label="" size="small" primaryColor="currentColor" />)}
            </button>
          </div>
        </div>

        {visibleSyntaxError && syntaxDetailsOpen && (
          <div
            className="ai-chat-popover"
            role="dialog"
            aria-label="Syntax issue details"
            data-testid="react-ai-chat-syntax-details"
            onClick={(event) => event.stopPropagation()}
          >
            <strong>1 syntax issue</strong>
            <p>{syntaxError.split("\n")[0]}</p>
            <div className="ai-chat-popover-action">
              <button
                type="button"
                className="ai-chat-primary-button"
                data-testid="react-ai-chat-auto-fix"
                onClick={repairSyntax}
              >
                Fix syntax
              </button>
            </div>
          </div>
        )}
      </header>

      <div
        ref={messageListRef}
        className="ai-chat-scroll"
        {...(overlayOpen ? { inert: "" } : {})}
      >
        {messages.length === 0 && !isThinking ? (
          <section className="ai-chat-empty" data-testid="react-ai-chat-empty-state">
            <h3>What should change?</h3>
            <div className="ai-chat-quick">
              <p className="ai-chat-label">Suggested edits</p>
              <div className="ai-chat-quick-list">
                {AI_CHAT_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className="ai-chat-quick-button"
                    title={suggestion.description}
                    aria-label={`${suggestion.label}. ${suggestion.description}`}
                    onClick={() => selectSuggestion(suggestion)}
                  >
                    <span className="ai-chat-quick-copy">
                      <strong>{suggestion.label}</strong>
                      <span className="ai-chat-quick-description">
                        {suggestion.description}
                      </span>
                    </span>
                    <span className="ai-chat-quick-arrow">
                      {icon(<ArrowRightIcon label="" size="small" primaryColor="currentColor" />)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <section className="ai-chat-conversation" data-testid="react-ai-chat-conversation">
            {messages.map((message) => (
              <article key={message.id} className="ai-chat-turn">
                {message.role === "user" ? (
                  <div className="ai-chat-user-bubble">{message.text}</div>
                ) : (
                  <div className="ai-chat-assistant-message">
                    {message.text && (
                      <p className="ai-chat-assistant-text">{message.text}</p>
                    )}
                    {message.preview && (
                      <div
                        className="ai-chat-preview"
                        data-testid="react-ai-change-preview"
                      >
                        <div className="ai-chat-preview-header">
                          <span>{message.preview.title}</span>
                          {message.preview.previousVersionId && (
                            <button
                              type="button"
                              className="ai-chat-undo"
                              data-testid="react-ai-chat-undo"
                              onClick={() => undoPreview(message.preview!)}
                            >
                              Undo
                            </button>
                          )}
                        </div>
                        <ul className="ai-chat-changes">
                          {message.preview.items.map((item) => (
                            <li key={item}>
                              <span className="ai-chat-change-icon">
                                {icon(
                                  <CheckCircleIcon
                                    label=""
                                    size="small"
                                    primaryColor="currentColor"
                                  />,
                                )}
                              </span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="ai-chat-diff-toggle"
                          aria-expanded={openDiffIds.includes(message.id)}
                          onClick={() => toggleDiff(message.id)}
                        >
                          <span>
                            {openDiffIds.includes(message.id)
                              ? "Hide code diff"
                              : "View code diff"}
                          </span>
                          <span
                            className={`ai-chat-disclosure-icon ${
                              openDiffIds.includes(message.id) ? "is-open" : ""
                            }`}
                          >
                            {icon(
                              <ChevronDownIcon
                                label=""
                                size="small"
                                primaryColor="currentColor"
                              />,
                            )}
                          </span>
                        </button>
                        {openDiffIds.includes(message.id) && (
                          <div className="ai-chat-diff" data-testid="react-ai-chat-diff">
                            <div className="ai-chat-diff-header">
                              <span className="ai-chat-diff-title">
                                <span>Code diff</span>
                                <span className="ai-chat-diff-location">
                                  {message.preview.diffLocation}
                                </span>
                              </span>
                              <span className="ai-chat-diff-actions">
                                <button
                                  type="button"
                                  className="ai-chat-diff-action"
                                  aria-label="Expand code diff"
                                  title="Expand code diff"
                                  data-testid="react-ai-chat-diff-expand"
                                  onClick={() => openExpandedDiff(message.id)}
                                >
                                  {icon(
                                    <FullScreenOnIcon
                                      label=""
                                      size="small"
                                      primaryColor="currentColor"
                                    />,
                                  )}
                                </button>
                              </span>
                            </div>
                            <div className="ai-chat-diff-code">
                              {message.preview.diffLines.map((line, index) => (
                                <div
                                  key={`${message.id}-${index}`}
                                  className={`ai-chat-diff-line is-${line.type}`}
                                >
                                  <span aria-hidden="true">
                                    {line.type === "add"
                                      ? "+"
                                      : line.type === "remove"
                                        ? "-"
                                        : " "}
                                  </span>
                                  <code>{line.code}</code>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="ai-chat-preview-actions">
                          <button
                            type="button"
                            className="ai-chat-secondary-button"
                            onClick={() => {
                              setPrompt(
                                "Keep the retry path, but make the timeout return a clear user-facing response.",
                              );
                              focusInput();
                            }}
                          >
                            Refine
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}

            {isThinking && (
              <article
                className="ai-chat-turn ai-chat-assistant-message"
                role="status"
                aria-live="polite"
                data-testid="react-ai-chat-thinking"
              >
                <ol className="ai-chat-progress">
                  {stages.map((stage, index) => (
                    <li
                      key={stage}
                      className={`ai-chat-stage ${
                        stageIndex > index
                          ? "is-done"
                          : stageIndex === index
                            ? "is-active"
                            : ""
                      }`}
                    >
                      <span className="ai-chat-stage-marker">
                        {stageIndex > index
                          ? icon(<CheckIcon label="" size="small" primaryColor="currentColor" />)
                          : index + 1}
                      </span>
                      <strong>{stageIndex > index ? completedStages[index] : stage}</strong>
                    </li>
                  ))}
                </ol>
              </article>
            )}
          </section>
        )}
      </div>

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
            <header className="ai-chat-diff-fullscreen-header">
              <span className="ai-chat-diff-fullscreen-title">
                <span>Code diff</span>
                <span className="ai-chat-diff-location">
                  {expandedDiffPreview.diffLocation}
                </span>
              </span>
              <button
                type="button"
                className="ai-chat-diff-action"
                aria-label="Close expanded code diff"
                title="Close expanded code diff"
                data-testid="react-ai-chat-diff-fullscreen-close"
                onClick={closeExpandedDiff}
              >
                {icon(<CrossIcon label="" size="small" primaryColor="currentColor" />)}
              </button>
            </header>
            <div className="ai-chat-diff-code ai-chat-diff-code-expanded">
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
          <header className="ai-chat-history-header">
            <h3>Diagram versions</h3>
            <button
              type="button"
              className="ai-chat-head-button ai-chat-close"
              aria-label="Close diagram versions"
              onClick={() => setHistoryOpen(false)}
            >
              {icon(<CrossIcon label="" size="small" primaryColor="currentColor" />)}
            </button>
          </header>
          <ol className="ai-chat-history-list">
            {[...versions].reverse().map((version) => (
              <li
                key={version.id}
                className={`ai-chat-history-item ${
                  version.id === currentVersionId ? "is-current" : ""
                }`}
              >
                <div>
                  <p className="ai-chat-history-title">
                    <strong>v{version.id}</strong>
                    <span>{version.summary}</span>
                  </p>
                  <p className="ai-chat-history-detail">{version.detail}</p>
                </div>
                <button
                  type="button"
                  className="ai-chat-rollback"
                  disabled={version.id === currentVersionId}
                  onClick={() => restoreVersion(version)}
                >
                  {version.id === currentVersionId ? "Current" : "Restore version"}
                </button>
                <div className="ai-chat-history-meta">
                  {version.time} · {version.syntaxResolved ? "Syntax valid" : "1 syntax issue"}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <form
        className="ai-chat-composer"
        {...(overlayOpen ? { inert: "" } : {})}
        onSubmit={submitPrompt}
      >
        <div className="ai-chat-compose-box">
          <textarea
            ref={inputRef}
            value={prompt}
            rows={2}
            placeholder="Describe the diagram change..."
            aria-label="AI change request"
            data-testid="react-ai-chat-input"
            disabled={isThinking}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="ai-chat-compose-meta">
            <button
              type="button"
              className="ai-chat-history-trigger"
              aria-expanded={historyOpen}
              aria-label="Open diagram versions"
              data-testid="react-ai-chat-history-trigger"
              onClick={() => {
                setSyntaxDetailsOpen(false);
                setHistoryOpen(true);
                trackAnalyticsEvent("ai_chat_history_opened", {
                  ...analyticsBase(),
                  version_id: currentVersionId,
                });
              }}
            >
              {icon(<ClockIcon label="" size="small" primaryColor="currentColor" />)}
              <span>Diagram versions</span>
              <span className="ai-chat-history-count">{versions.length}</span>
            </button>
            <span className="ai-chat-compose-actions">
              <span className="ai-chat-compose-status">
                {isThinking ? "Updating" : "Ready"}
              </span>
              <button
                type="submit"
                className="ai-chat-send"
                aria-label="Send message"
                data-testid="react-ai-chat-send"
                disabled={!prompt.trim() || isThinking}
              >
                {icon(<SendIcon label="" size="small" primaryColor="currentColor" />)}
              </button>
            </span>
          </div>
        </div>
      </form>
    </aside>
  );
}
