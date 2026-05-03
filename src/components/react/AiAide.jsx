import React, { useEffect } from 'react';

import styled from 'styled-components';
import DebugComponent from './components/DebugComponent';
import Conversations from './components/Conversations';
import MessageSender from './components/MessageSender';
import uuidv4 from '@/utils/uuid';
import Button from '@atlaskit/button';
import { diagramlyChat } from '@/services/GenerateService';
import { CloseButton } from './CloseButton';

const Page = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: start;
  height: 100vh;
  margin: 0 auto;
  overflow: hidden;
`;

const Wrapper = styled.div`
  display: flex;
  height: 100%;
  width: 100%;
  margin: 0 auto;
  flex-direction: column;
  flex-grow: 1;
  justify-content: space-between;
  overflow: hidden;
  h2 {
    line-height: 1;
  }
`;

const StyledButton = styled(Button)`
  && {
    position: fixed;
  }
  top: 16px;
  right: 16px;
`;

const CloseContainer = styled.div`
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
`;

const FormDefaultExample = () => {
  const [sessions, setSessions] = React.useState([]);

  const isMountedRef = React.useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const safeSetSessions = React.useCallback((updater) => {
    if (isMountedRef.current) setSessions(updater);
  }, []);

  const handleSubmit = React.useCallback(
    async (prompt) => {

      console.log('submitting');
      const chat = {
        type: 'user',
        message: prompt,
        id: uuidv4(),
      };

      safeSetSessions((prev) => [...prev, chat]);
      const chatId = uuidv4();
      const newMessage = {
        type: 'gpt',
        message: '',
        id: chatId,
        loading: true,
      };

      safeSetSessions((prev) => [...prev, newMessage]);
      try {
        const response = await diagramlyChat([
          {
            id: chatId,
            role: 'user',
                parts: [{
                  type: 'text',
                  text: prompt,
                }],
            },
          ]
        );

        console.log('response received', response);

        if (!isMountedRef.current) return;

        const answer = response.messages.find((msg) => msg.id === chatId && msg.role === 'assistant');
        if (!answer) {
          throw new Error('No answer from AI');
        }
        const answerText = answer.parts.map((part) => part.text).join('');

        safeSetSessions((prev) => {
          const updatedSessions = prev.map((chat) => {
            if (chat.id === chatId && chat.type === 'gpt') {
              return {
                ...chat,
                message: chat.message + answerText,
                loading: false,
              };
            }
            return chat;
          });
          return updatedSessions;
        });

        //   refresh qutta
      } catch (e) {
        if (!isMountedRef.current) return;
        safeSetSessions((prev) => {
          const updatedSessions = prev.map((chat) => {
            if (chat.id === chatId) {
              return {
                ...chat,
                message: 'An error occurred, please try again later.',
                loading: false,
              };
            }
            return chat;
          });
          return updatedSessions;
        });
      }
    },
    []
  );

  const handleExit = React.useCallback(async () => {
    try {
      const { view } = await import('@forge/bridge');
      await view.submit();
    } catch (e) {
      console.error('Failed to close AI aide', e);
    }
  }, []);

  return (
    <Page>
      <DebugComponent />
      <CloseContainer>
        <CloseButton exit={handleExit} label="X" small={true} />
      </CloseContainer>
      <Wrapper>
        <Conversations sessions={sessions} />
        <MessageSender onSubmit={handleSubmit} />
      </Wrapper>
    </Page>
  );
};

export default FormDefaultExample;
