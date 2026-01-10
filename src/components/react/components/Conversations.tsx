import * as React from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import styled from 'styled-components';
import useScrollToBttom from '../hooks/useScrollToBottom';

const ConversationWrapper = styled.div`
  padding: 60px 0;
  overflow-y: auto;
  flex: 1;
`;

const PlaceholderBox = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  flex-direction: column;
`;

const Conversations = ({ sessions = [] }) => {
  const boxRef = React.createRef();

  useScrollToBttom(boxRef);

  if (sessions.length === 0) {
    return (
      <PlaceholderBox>
        <img alt="No contents here" src="./image/placeholder.svg" width={200} />
        No contents here yet...
      </PlaceholderBox>
    );
  }

  return (
    <ConversationWrapper ref={boxRef}>
      {sessions.map((chat, index) => {
        return (
          <MarkdownRenderer
            key={chat.id}
            loading={chat.loading}
            isGPT={chat.type === 'gpt'}
            content={chat.message}
          />
        );
      })}
    </ConversationWrapper>
  );
};

export default Conversations;
