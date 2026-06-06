import React, { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

type Suggestion = {
  id: string;
  label: string;
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
  diagramType?: string;
  prototypeMode?: boolean;
  initialMessages?: AIChatMessage[];
  onClose: () => void;
  onSend?: (prompt: string) => void;
  onApply?: (message: AIChatMessage) => void;
}

const suggestions: Suggestion[] = [
  { id: "add-error-path", label: "Add an error handling path" },
  { id: "simplify-flow", label: "Simplify the main flow" },
  { id: "highlight-steps", label: "Highlight the key steps" },
];

function Icon({
  children,
  className = "h-4 w-4",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export default function AIChatPanel({
  open,
  diagramType = "openapi",
  prototypeMode = false,
  initialMessages = [],
  onClose,
  onSend,
  onApply,
}: Props) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AIChatMessage[]>(() =>
    initialMessages.map((message) => ({ ...message })),
  );
  const [isThinking, setIsThinking] = useState(false);
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

  useEffect(() => {
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
            text: "The conversation flow is ready. Once the AI service is connected, the proposed update will appear here for review.",
            preview: {
              title: "Proposed update",
              items: [
                `Keep the current ${diagramTypeLabel} format`,
                "Preserve the existing API operations and schemas",
                "Show a review step before applying changes",
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
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <Icon>
              <path d="m12 3-1.2 3.2L7.5 7.5l3.3 1.3L12 12l1.2-3.2 3.3-1.3-3.3-1.3L12 3Z" />
              <path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8L5 14Z" />
              <path d="m18 13-1 2.7-2.7 1L17 18l1 2.7 1-2.7 2.7-1-2.7-1L18 13Z" />
            </Icon>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-slate-900">
                AI diagram assistant
              </h2>
              {prototypeMode && (
                <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                  Preview
                </span>
              )}
            </div>
            <p className="truncate text-xs text-slate-500">{diagramTypeLabel} diagram</p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
          aria-label="Close AI chat"
          data-testid="react-ai-chat-close"
          onClick={onClose}
        >
          <Icon className="h-5 w-5">
            <path d="m6 6 12 12M18 6 6 18" />
          </Icon>
        </button>
      </header>

      <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && !isThinking ? (
          <div
            className="flex min-h-full flex-col justify-center px-5 py-8"
            data-testid="react-ai-chat-empty-state"
          >
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-700">
              <Icon className="h-5 w-5">
                <path d="M8 10h8M8 14h5" />
                <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-3.5-.7L4 20l1.4-4A7.7 7.7 0 0 1 4 11.5 7.5 7.5 0 0 1 12 4a7.5 7.5 0 0 1 8 7.5Z" />
              </Icon>
            </div>
            <h3 className="mt-4 text-center text-base font-semibold text-slate-900">
              What would you like to change?
            </h3>
            <p className="mx-auto mt-1.5 max-w-64 text-center text-sm leading-5 text-slate-500">
              Describe the outcome. AI will propose an update before changing your API diagram.
            </p>

            <div className="mt-6 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Try a request
              </p>
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className="group flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-left text-sm text-slate-700 transition-all hover:border-violet-300 hover:bg-violet-50/50 hover:text-violet-800"
                  onClick={() => selectSuggestion(suggestion)}
                >
                  <span>{suggestion.label}</span>
                  <Icon className="h-4 w-4 text-slate-300 transition-colors group-hover:text-violet-500">
                    <path d="M7 17 17 7M8 7h9v9" />
                  </Icon>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5 px-4 py-5" data-testid="react-ai-chat-conversation">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.role === "assistant" && (
                  <div className="mr-2 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                    <Icon className="h-3.5 w-3.5">
                      <path d="m12 3-1.2 3.2L7.5 7.5l3.3 1.3L12 12l1.2-3.2 3.3-1.3-3.3-1.3L12 3Z" />
                      <path d="m5 14-.8 2.2L2 17l2.2.8L5 20l.8-2.2L8 17l-2.2-.8L5 14Z" />
                    </Icon>
                  </div>
                )}
                <div
                  className={`max-w-[86%] text-sm leading-5 ${
                    message.role === "user"
                      ? "rounded-2xl rounded-br-md bg-slate-900 px-3.5 py-2.5 text-white"
                      : "text-slate-700"
                  }`}
                >
                  <p>{message.text}</p>
                  {message.preview && (
                    <div
                      className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                      data-testid="react-ai-change-preview"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-emerald-600">
                            <path d="M9 11.5 11 14l4-5" />
                            <path d="M6 3h9l3 3v15H6z" />
                          </Icon>
                          <span className="text-xs font-semibold text-slate-900">
                            {message.preview.title}
                          </span>
                        </div>
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          Backend pending
                        </span>
                      </div>
                      <ul className="space-y-2 px-3 py-3 text-xs text-slate-600">
                        {message.preview.items.map((item) => (
                          <li key={item} className="flex items-start gap-2">
                            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600">
                              <path d="m5 12 4 4L19 6" />
                            </Icon>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="flex gap-2 border-t border-slate-100 bg-slate-50 px-3 py-2.5">
                        <button
                          type="button"
                          className="flex-1 rounded-md bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                          disabled={prototypeMode}
                          title={prototypeMode ? "AI integration will enable this action" : undefined}
                          onClick={() => applyChange(message)}
                        >
                          Apply changes
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100"
                          onClick={focusInput}
                        >
                          Refine
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isThinking && (
              <div className="flex items-start" data-testid="react-ai-chat-thinking">
                <div className="mr-2 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                  <Icon className="h-3.5 w-3.5">
                    <path d="m12 3-1.2 3.2L7.5 7.5l3.3 1.3L12 12l1.2-3.2 3.3-1.3-3.3-1.3L12 3Z" />
                  </Icon>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-500 shadow-sm">
                  Planning the change
                  <span className="ml-1 inline-flex gap-0.5" aria-hidden="true">
                    <span className="react-ai-chat-dot">.</span>
                    <span className="react-ai-chat-dot">.</span>
                    <span className="react-ai-chat-dot">.</span>
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form className="shrink-0 border-t border-slate-200 bg-slate-50/80 p-3" onSubmit={submitPrompt}>
        <div className="rounded-xl border border-slate-300 bg-white p-2 shadow-sm transition focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100">
          <textarea
            ref={inputRef}
            value={prompt}
            rows={3}
            className="block max-h-32 min-h-16 w-full resize-none border-0 bg-transparent px-1.5 py-1 text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400"
            placeholder="Describe how you want to change the API diagram..."
            aria-label="AI change request"
            data-testid="react-ai-chat-input"
            disabled={isThinking}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
          />
          <div className="mt-1 flex items-center justify-between gap-2 px-1">
            <span className="text-[11px] text-slate-400">Enter to send · Shift+Enter for new line</span>
            <button
              type="submit"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white transition-all hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
              aria-label="Send message"
              data-testid="react-ai-chat-send"
              disabled={!prompt.trim() || isThinking}
            >
              <Icon>
                <path d="m4 4 16 8-16 8 3-8-3-8Z" />
                <path d="M7 12h13" />
              </Icon>
            </button>
          </div>
        </div>
        {prototypeMode && (
          <p className="mt-2 text-center text-[10px] text-slate-400">
            UI preview only. No API specification will be changed.
          </p>
        )}
      </form>
    </aside>
  );
}
