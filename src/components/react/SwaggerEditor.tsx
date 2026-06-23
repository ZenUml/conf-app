import React, { useEffect, useState } from "react";
import Header from "@/components/react/Header";
import AIChatPanel from "@/components/react/AIChatPanel";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import store from "@/model/store2";

interface Props {
  saveAndExit: VoidFunction;
  exit: VoidFunction;
}
const Component = ({ saveAndExit, exit }: Props) => {
  const [showAIChat, setShowAIChat] = useState(false);
  const [showCodeEditor, setShowCodeEditor] = useState(true);
  const [syntaxError, setSyntaxError] = useState(() => store.state.error?.toString() || "");
  const [currentCode, setCurrentCode] = useState(() => store.state.diagram.code || "");
  const [diagramlyDiagramId, setDiagramlyDiagramId] = useState(
    () => (store.state.diagram.metadata as any)?.aiChat?.diagramlyDiagramId || "",
  );
  const [syntaxRepairRequestId, setSyntaxRepairRequestId] = useState(0);

  useEffect(() => {
    return store.subscribe((mutation, state) => {
      if (mutation.type === "updateError") {
        setSyntaxError(state.error?.toString() || "");
      }
      if (mutation.type === "updateCode2") {
        setCurrentCode(state.diagram.code || "");
      }
      if (mutation.type === "updateMetadata") {
        setDiagramlyDiagramId((state.diagram.metadata as any)?.aiChat?.diagramlyDiagramId || "");
      }
    });
  }, []);

  const bindDiagramlyDiagram = (diagramId: string) => {
    store.dispatch("updateMetadata", {
      ...(store.state.diagram.metadata || {}),
      aiChat: {
        ...((store.state.diagram.metadata as any)?.aiChat || {}),
        diagramlyDiagramId: diagramId,
      },
    });
  };

  const toggleAIChat = () => {
    setShowAIChat((current) => {
      const next = !current;
      setShowCodeEditor(!next);
      trackAnalyticsEvent(next ? "ai_chat_opened" : "ai_chat_closed", {
        feature_area: "ai",
        surface: "editor",
        macro_type: "openapi",
        ...(next && { entry_point: "ai_prompt" as const }),
      });
      return next;
    });
  };

  const openAIChat = (entryPoint: "ai_prompt" | "ai_repair") => {
    setShowAIChat((current) => {
      if (!current) {
        trackAnalyticsEvent("ai_chat_opened", {
          feature_area: "ai",
          surface: "editor",
          macro_type: "openapi",
          entry_point: entryPoint,
        });
      }
      return true;
    });
    setShowCodeEditor(false);
  };

  useEffect(() => {
    const requestSyntaxRepair = () => {
      openAIChat("ai_repair");
      setSyntaxRepairRequestId((current) => current + 1);
    };

    window.addEventListener("ai-chat-request-syntax-repair", requestSyntaxRepair);
    return () => {
      window.removeEventListener("ai-chat-request-syntax-repair", requestSyntaxRepair);
    };
  }, []);

  const closeAIChat = () => {
    if (!showAIChat) return;
    setShowAIChat(false);
    setShowCodeEditor(true);
    trackAnalyticsEvent("ai_chat_closed", {
      feature_area: "ai",
      surface: "editor",
      macro_type: "openapi",
    });
  };

  return (
    <div style={{ position: 'relative', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0 }}>
        <Header
          saveAndExit={saveAndExit}
          exit={exit}
          aiChatOpen={showAIChat}
          onToggleAiChat={toggleAIChat}
        />
      </div>
      <div
        className={`swagger-editor-workspace ${showCodeEditor ? "" : "code-editor-hidden"}`}
      >
        {showAIChat && (
          <div className="react-ai-chat-panel-container">
            <AIChatPanel
              open={showAIChat}
              codeVisible={showCodeEditor}
              diagramType="openapi"
              syntaxError={syntaxError}
              syntaxRepairRequestId={syntaxRepairRequestId}
              currentCode={currentCode}
              diagramTitle={store.state.diagram.title || ""}
              diagramlyDiagramId={diagramlyDiagramId}
              onClose={closeAIChat}
              onToggleCode={() => setShowCodeEditor((current) => !current)}
              onApplyCode={(code) => store.dispatch("updateCode2", code)}
              onDiagramlyDiagramBound={bindDiagramlyDiagram}
            />
          </div>
        )}
        {showAIChat && (
          <button
            type="button"
            className="react-ai-chat-workspace-backdrop"
            aria-label="Close AI chat"
            data-testid="react-ai-chat-backdrop"
            onClick={closeAIChat}
          />
        )}
        <div id="swagger-editor" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}></div>
      </div>
      <div id="syntax-error-box" style={{
        display: showAIChat ? 'none' : 'block',
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        backgroundColor: 'white',
        flexShrink: 0
      }}></div>
    </div>
  );
};

export default Component;
