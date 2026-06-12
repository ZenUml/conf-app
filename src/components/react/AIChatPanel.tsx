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
import CodeIcon from "@atlaskit/icon/glyph/code";
import CrossIcon from "@atlaskit/icon/glyph/cross";
import DocumentIcon from "@atlaskit/icon/glyph/document";
import EditIcon from "@atlaskit/icon/glyph/edit";
import ErrorIcon from "@atlaskit/icon/glyph/error";
import SendIcon from "@atlaskit/icon/glyph/send";
import StarIcon from "@atlaskit/icon/glyph/star";
import StatusIcon from "@atlaskit/icon/glyph/status";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

type Suggestion = {
  id: string;
  label: string;
  description: string;
};

type ChangePreview = {
  title: string;
  items: string[];
};

export type AIChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  preview?: ChangePreview;
};

interface Props {
  open: boolean;
  codeVisible?: boolean;
  diagramType?: string;
  syntaxError?: string;
  prototypeMode?: boolean;
  initialMessages?: AIChatMessage[];
  onClose: () => void;
  onToggleCode?: () => void;
  onSend?: (prompt: string) => void;
  onApply?: (message: AIChatMessage) => void;
}

const suggestions: Suggestion[] = [
  {
    id: "add-error-path",
    label: "Add an error handling path",
    description: "Include failure, retry, or timeout behavior.",
  },
  {
    id: "simplify-flow",
    label: "Simplify the main flow",
    description: "Reduce noise and make the happy path easier to scan.",
  },
  {
    id: "highlight-steps",
    label: "Highlight the key steps",
    description: "Emphasize the most important interactions.",
  },
];

function AssistantIdentity() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-50 text-violet-700">
        <StarIcon label="" size="small" primaryColor="currentColor" />
      </div>
      <span className="text-xs font-semibold text-slate-700">AI Assistant</span>
    </div>
  );
}

function StageMarker({
  children,
  state,
}: {
  children: React.ReactNode;
  state: "done" | "active" | "pending";
}) {
  const stateClasses = {
    done: "bg-emerald-500 text-white",
    active: "bg-violet-600 text-white ring-4 ring-violet-100",
    pending: "border border-slate-200 bg-white text-slate-400",
  };

  return (
    <span
      className={`absolute -left-[30px] -top-px flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-bold ${stateClasses[state]}`}
    >
      {children}
    </span>
  );
}

function CompletedStages() {
  return (
    <div
      className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-500"
      data-testid="react-ai-chat-complete-status"
    >
      <span className="flex items-center gap-1 text-emerald-700">
        <CheckCircleIcon label="" size="small" primaryColor="currentColor" />
        Understood
      </span>
      <span aria-hidden="true">·</span>
      <span className="flex items-center gap-1 text-emerald-700">
        <CheckCircleIcon label="" size="small" primaryColor="currentColor" />
        Updated
      </span>
      <span aria-hidden="true">·</span>
      <span className="font-semibold text-violet-700">Ready to review</span>
    </div>
  );
}

export default function AIChatPanel({
  open,
  codeVisible = false,
  diagramType = "openapi",
  syntaxError = "",
  prototypeMode = false,
  initialMessages = [],
  onClose,
  onToggleCode,
  onSend,
  onApply,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AIChatMessage[]>(() =>
    initialMessages.map((message) => ({ ...message })),
  );
  const [isThinking, setIsThinking] = useState(false);
  const [syntaxDetailsOpen, setSyntaxDetailsOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (messageList) {
      messageList.scrollTop = messageList.scrollHeight;
    }
  }, [messages, isThinking]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!syntaxError) setSyntaxDetailsOpen(false);
  }, [syntaxError]);

  if (!open) return null;

  const focusInput = () => {
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const selectSuggestion = (suggestion: Suggestion) => {
    setPrompt(suggestion.label);
    trackAnalyticsEvent("ai_chat_suggestion_selected", {
      feature_area: "ai",
      surface: "editor",
      macro_type: "openapi",
      suggestion_id: suggestion.id,
    });
    focusInput();
  };

  const submitPrompt = (event?: FormEvent) => {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || isThinking) return;

    const userMessage: AIChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
    };
    setMessages((current) => [...current, userMessage]);
    setPrompt("");

    trackAnalyticsEvent("ai_chat_prompt_submitted", {
      feature_area: "ai",
      surface: "editor",
      macro_type: "openapi",
      generation_source: "chat_panel",
      prompt_length: text.length,
      chat_message_count: messages.length + 1,
    });
    onSend?.(text);

    if (prototypeMode) {
      setIsThinking(true);
      previewTimerRef.current = setTimeout(() => {
        setMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            text: "I prepared a focused update that keeps the current API structure intact.",
            preview: {
              title: "Update ready",
              items: [
                `Keep the current ${diagramTypeLabel} format`,
                "Preserve the existing API operations and schemas",
                "Add a review step before any change is applied",
              ],
            },
          },
        ]);
        setIsThinking(false);
      }, 700);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitPrompt();
    }
  };

  const applyChange = (message: AIChatMessage) => {
    trackAnalyticsEvent("ai_chat_change_applied", {
      feature_area: "ai",
      surface: "editor",
      macro_type: "openapi",
      chat_message_count: messages.length,
    });
    onApply?.(message);
  };

  return (
    <aside
      className="flex h-full w-full flex-col bg-white"
      aria-label="AI diagram assistant"
      data-testid="react-ai-chat-panel"
    >
      <header className="shrink-0 border-b border-slate-200 px-3.5 py-2.5">
        <div
          className="flex min-w-0 items-center gap-2"
          data-testid="react-ai-chat-header-row"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
              <StarIcon label="" size="small" primaryColor="currentColor" />
            </div>
            <h2 className="truncate text-sm font-semibold text-slate-900">AI Assistant</h2>
            {syntaxError && (
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-200"
                aria-label="Show syntax issue details"
                aria-expanded={syntaxDetailsOpen}
                data-testid="react-ai-chat-syntax-indicator"
                onClick={() => setSyntaxDetailsOpen((current) => !current)}
              >
                <ErrorIcon label="" size="small" primaryColor="currentColor" />
                <span>Syntax</span>
              </button>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onToggleCode && (
              <button
                type="button"
                className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
                aria-label={codeVisible ? "Hide code editor" : "Show code editor"}
                data-testid="react-ai-chat-code-toggle"
                onClick={onToggleCode}
              >
                <CodeIcon label="" size="small" primaryColor="currentColor" />
                <span>{codeVisible ? "Hide" : "Show"}</span>
              </button>
            )}
            <button
              type="button"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
              aria-label="Close AI chat"
              data-testid="react-ai-chat-close"
              onClick={onClose}
            >
              <CrossIcon label="" size="small" primaryColor="currentColor" />
            </button>
          </div>
        </div>
        {syntaxError && syntaxDetailsOpen && (
          <div
            className="mt-2 rounded-lg border border-rose-100 bg-rose-50/70 px-2.5 py-2"
            data-testid="react-ai-chat-syntax-details"
          >
            <p className="break-words text-xs leading-4 text-rose-800">
              {syntaxError.split("\n")[0]}
            </p>
          </div>
        )}
      </header>

      <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && !isThinking ? (
          <div className="px-3.5 py-4" data-testid="react-ai-chat-empty-state">
            <div className="rounded-xl bg-slate-50 px-3.5 py-3.5">
              <h3 className="text-base font-semibold text-slate-900">
                How should I update this diagram?
              </h3>
              <p className="mt-1.5 text-sm leading-5 text-slate-600">
                Describe the outcome. I will prepare the change and show you exactly what will be
                updated.
              </p>
              <div className="mt-3 flex items-start gap-2 text-xs leading-4 text-slate-500">
                <span className="mt-0.5 shrink-0 text-emerald-600">
                  <StatusIcon label="" size="small" primaryColor="currentColor" />
                </span>
                <span>Your API diagram stays unchanged until you apply the proposal.</span>
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Common changes
              </p>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-violet-50/60 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-violet-200"
                    onClick={() => selectSuggestion(suggestion)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 group-hover:text-violet-800">
                        {suggestion.label}
                      </p>
                      <p className="mt-0.5 text-xs leading-4 text-slate-500">
                        {suggestion.description}
                      </p>
                    </div>
                    <span className="shrink-0 text-slate-300 group-hover:text-violet-500">
                      <ArrowRightIcon label="" size="small" primaryColor="currentColor" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-3.5 py-4" data-testid="react-ai-chat-conversation">
            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="rounded-lg bg-slate-50 px-3 py-2.5">
                  <span className="text-[11px] font-semibold text-slate-500">You</span>
                  <p className="text-sm leading-5 text-slate-800">{message.text}</p>
                </div>
              ) : (
                <div key={message.id} className="w-full">
                  <AssistantIdentity />
                  <p className="mt-2 text-sm leading-5 text-slate-600">{message.text}</p>

                  {message.preview && (
                    <>
                      <CompletedStages />
                      <div
                        className="mt-3 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/50"
                        data-testid="react-ai-change-preview"
                      >
                        <div className="flex items-center gap-2 border-b border-violet-100 px-3 py-2.5">
                          <span className="text-violet-700">
                            <DocumentIcon label="" size="small" primaryColor="currentColor" />
                          </span>
                          <span className="text-sm font-semibold text-violet-900">
                            {message.preview.title}
                          </span>
                        </div>
                        <ul className="space-y-2 px-3 py-3 text-xs leading-4 text-slate-700">
                          {message.preview.items.map((item) => (
                            <li key={item} className="flex items-start gap-2">
                              <span className="mt-px shrink-0 text-violet-600">
                                <CheckCircleIcon
                                  label=""
                                  size="small"
                                  primaryColor="currentColor"
                                />
                              </span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="mx-3 flex items-start gap-2 border-t border-violet-100 py-2.5 text-[11px] leading-4 text-slate-500">
                          <span className="mt-px shrink-0 text-slate-400">
                            <StatusIcon label="" size="small" primaryColor="currentColor" />
                          </span>
                          <span>Your current API diagram stays unchanged until you click Apply.</span>
                        </div>
                        <div className="flex gap-2 bg-white/70 px-2.5 py-2.5">
                          <button
                            type="button"
                            className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:ring-offset-1 disabled:cursor-not-allowed disabled:bg-violet-400"
                            disabled={prototypeMode}
                            title={
                              prototypeMode
                                ? "Available when the AI service is connected"
                                : undefined
                            }
                            onClick={() => applyChange(message)}
                          >
                            <span>Apply to diagram</span>
                            <StarIcon label="" size="small" primaryColor="currentColor" />
                          </button>
                          <button
                            type="button"
                            className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-200"
                            onClick={focusInput}
                          >
                            Refine
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ),
            )}

            {isThinking && (
              <div
                className="w-full"
                role="status"
                aria-live="polite"
                data-testid="react-ai-chat-thinking"
              >
                <AssistantIdentity />
                <ol className="mt-3 ml-2.5 border-l border-slate-200 pl-5">
                  <li className="relative pb-3">
                    <StageMarker state="done">
                      <CheckIcon label="" size="small" primaryColor="currentColor" />
                    </StageMarker>
                    <p className="text-xs font-semibold text-slate-800">Understanding request</p>
                    <p className="mt-0.5 text-xs leading-4 text-slate-500">
                      Reading the current {diagramTypeLabel} diagram and your instruction.
                    </p>
                  </li>
                  <li className="relative pb-3">
                    <StageMarker state="active">2</StageMarker>
                    <p className="text-xs font-semibold text-violet-800">Updating diagram</p>
                    <p className="mt-0.5 text-xs leading-4 text-slate-500">
                      Building a safe proposal for you to review.
                    </p>
                  </li>
                  <li className="relative">
                    <StageMarker state="pending">3</StageMarker>
                    <p className="text-xs font-medium text-slate-400">Preparing preview</p>
                  </li>
                </ol>
              </div>
            )}
          </div>
        )}
      </div>

      <form className="shrink-0 border-t border-slate-200 bg-white p-2.5" onSubmit={submitPrompt}>
        <div className="rounded-xl border border-slate-300 bg-white p-2 shadow-sm transition focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
          <textarea
            ref={inputRef}
            value={prompt}
            rows={2}
            className="block max-h-28 min-h-11 w-full resize-none border-0 bg-transparent px-1 py-0.5 text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400"
            placeholder="Describe how you want to change the diagram..."
            aria-label="AI change request"
            data-testid="react-ai-chat-input"
            disabled={isThinking}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="mt-1 flex items-center justify-between gap-2 px-1">
            <span className="flex min-w-0 items-center gap-1 text-[10px] font-medium text-slate-500">
              <EditIcon label="" size="small" primaryColor="currentColor" />
              Editing {diagramTypeLabel}
            </span>
            <span className="ml-auto text-[10px] text-slate-400">Enter ↵</span>
            <button
              type="submit"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              aria-label="Send message"
              data-testid="react-ai-chat-send"
              disabled={!prompt.trim() || isThinking}
            >
              <SendIcon label="" size="small" primaryColor="currentColor" />
            </button>
          </div>
        </div>
      </form>
    </aside>
  );
}
