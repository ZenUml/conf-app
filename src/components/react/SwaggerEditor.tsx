import React, { useState } from "react";
import Header from "@/components/react/Header";
import AIChatPanel from "@/components/react/AIChatPanel";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

interface Props {
  saveAndExit: VoidFunction;
  exit: VoidFunction;
}
const Component = ({ saveAndExit, exit }: Props) => {
  const [showAIChat, setShowAIChat] = useState(false);

  const toggleAIChat = () => {
    setShowAIChat((current) => {
      const next = !current;
      trackAnalyticsEvent(next ? "ai_chat_opened" : "ai_chat_closed", {
        feature_area: "ai",
        surface: "editor",
        macro_type: "openapi",
        ...(next && { entry_point: "ai_prompt" as const }),
      });
      return next;
    });
  };

  const closeAIChat = () => {
    if (!showAIChat) return;
    setShowAIChat(false);
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
      <div className="swagger-editor-workspace">
        {showAIChat && (
          <div className="react-ai-chat-panel-container">
            <AIChatPanel
              open={showAIChat}
              diagramType="openapi"
              prototypeMode
              onClose={closeAIChat}
            />
          </div>
        )}
        <div id="swagger-editor" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto' }}></div>
      </div>
      <div id="syntax-error-box" style={{
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
