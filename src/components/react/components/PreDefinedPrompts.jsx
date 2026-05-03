import React from 'react';
import { PRE_DEFINED_PROMPTS } from '../constant/prompt';
import styled from 'styled-components';
import { ButtonItem, MenuGroup, Section } from '@atlaskit/menu';
import MediaServicesDocumentIcon from '@atlaskit/icon/glyph/media-services/document';

const Title = styled.h4`
  margin-left: 16px;
  padding-top: 8px;
  padding-bottom: 8px;
  display: flex;
  align-items: center;
`;

const PreDefinedPrompts = ({ onSelect }) => {
  return (
    <MenuGroup
      maxWidth={400}
      minWidth={320}
      onClick={(e) => e.stopPropagation()}
    >
      <Section>
        <Title>
          <MediaServicesDocumentIcon />
          &nbsp; Predefined Prompts
        </Title>
      </Section>
      <Section hasSeparator>
        {PRE_DEFINED_PROMPTS.map((prompt) => (
          <ButtonItem
            key={prompt.title}
            onClick={() => onSelect(prompt.prompt)}
          >
            {prompt.title}
          </ButtonItem>
        ))}
      </Section>
    </MenuGroup>
  );
};

export default PreDefinedPrompts;
