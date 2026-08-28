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
  createCodePreview,
  type AIChatChangeKind,
  type AIChatMessage,
  type AIChatSuggestion,
} from "@/components/AIChat/aiChatPrototype";
import {
  runAIChatSession,
  type AIChatSessionStage,
} from "@/services/AIChatSessionService";

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
  const [activeStage, setActiveStage] = useState<AIChatSessionStage | null>(null);
  const [openDiffIds, setOpenDiffIds] = useState<string[]>([]);
  const [syntaxResolved, setSyntaxResolved] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const activeControllerRef = useRef<AbortController | null>(null);
  const activeDiagramIdRef = useRef(diagramlyDiagramId.trim());
  const activeCodeRef = useRef(currentCode);
  const activeVersionIdRef = useRef("");
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
  const activeStageIndex = stages.findIndex((stage) => stage.key === activeStage);
  const canSubmit = prompt.trim().length > 0 && !isThinking;
  const visibleSyntaxError = Boolean(syntaxError) && !syntaxResolved;
  const syntaxErrorSummary = syntaxError.split("\n")[0];

  function nextMessageId(role: AIChatMessage["role"]): string {
    messageSequenceRef.current += 1;
    return `${role}-${Date.now()}-${messageSequenceRef.current}`;
  }

  function cancelActiveRequest(): void {
    activeControllerRef.current?.abort();
    activeControllerRef.current = null;
    setIsThinking(false);
    setActiveStage(null);
  }

  function selectSuggestion(suggestion: AIChatSuggestion): void {
    setPrompt(suggestion.label);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function isDiffOpen(messageId: string): boolean {
    return openDiffIds.includes(messageId);
  }

  function toggleDiff(messageId: string): void {
    setOpenDiffIds((current) => current.includes(messageId)
      ? current.filter((id) => id !== messageId)
      : [...current, messageId]);
  }

  function handleClose(): void {
    cancelActiveRequest();
    onClose();
  }

  function repairSyntax(): void {
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
    if (!text || isThinking) return false;

    const previousCode = activeCodeRef.current;
    const previousVersionId = activeVersionIdRef.current;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setIsThinking(true);
    setActiveStage(activeDiagramIdRef.current ? "queued" : "ensuring");
    setMessages((current) => [
      ...current,
      { id: nextMessageId("user"), role: "user", text },
    ]);
    setPrompt("");
    onSend?.(text);

    try {
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
        },
      });
      if (activeControllerRef.current !== controller) return false;

      activeDiagramIdRef.current = result.diagramId;
      activeCodeRef.current = result.updatedCode;
      activeVersionIdRef.current = result.versionId;
      const preview = createCodePreview(
        diagramTypeLabel,
        kind,
        previousCode,
        result.updatedCode,
      );
      preview.versionId = result.versionId;
      preview.previousVersionId = previousVersionId || undefined;
      const message: AIChatMessage = {
        id: nextMessageId("assistant"),
        role: "assistant",
        text: "",
        preview,
      };

      setMessages((current) => [...current, message]);
      if (kind === "syntax_repair") setSyntaxResolved(true);
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

  useEffect(() => {
    if (!activeControllerRef.current) activeCodeRef.current = currentCode;
  }, [currentCode]);

  useEffect(() => {
    if (!activeControllerRef.current) {
      activeDiagramIdRef.current = diagramlyDiagramId.trim();
    }
  }, [diagramlyDiagramId]);

  useEffect(() => {
    if (syntaxError) setSyntaxResolved(false);
  }, [syntaxError]);

  useEffect(() => {
    if (
      !open
      || !syntaxRepairRequestId
      || syntaxRepairRequestId === lastHandledSyntaxRepairRequestIdRef.current
      || !syntaxError
      || isThinking
    ) {
      return;
    }

    lastHandledSyntaxRepairRequestIdRef.current = syntaxRepairRequestId;
    repairSyntax();
  }, [isThinking, open, syntaxError, syntaxRepairRequestId]);

  useEffect(() => {
    if (!open) cancelActiveRequest();
  }, [open]);

  useEffect(() => () => {
    activeControllerRef.current?.abort();
  }, []);

  if (!open) return null;

  return (
    <aside
      className="ai-chat-panel"
      aria-label="AI OpenAPI assistant"
      data-testid="react-ai-chat-panel"
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
                onClick={onToggleCode}
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
              disabled={isThinking}
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
                    <strong>{message.preview.title}</strong>
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
                          <strong>Code diff</strong>
                          <span>{message.preview.diffLocation}</span>
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

            {isThinking && (
              <article
                className="ai-chat-progress"
                role="status"
                aria-live="polite"
                data-testid="react-ai-chat-thinking"
              >
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
              </article>
            )}
          </section>
        )}
      </main>

      <form className="ai-chat-composer" onSubmit={submitForm}>
        <textarea
          ref={inputRef}
          value={prompt}
          rows={2}
          placeholder="Describe the API definition change..."
          aria-label="AI change request"
          data-testid="react-ai-chat-input"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleInputKeyDown}
        />
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
