import Form, { Field, HelperMessage } from '@atlaskit/form';
import React from 'react';
import Popup from '@atlaskit/popup';
import PreDefinedPrompts from './PreDefinedPrompts';
import LightbulbFilledIcon from '@atlaskit/icon/glyph/lightbulb-filled';
import LoadingButton from '@atlaskit/button/loading-button';
import styled from 'styled-components';
import TextArea from '@atlaskit/textarea';
import { openUrl } from '@/model/globals/forgeGlobal';

const ChatSendBox = styled.div`
  position: sticky;
  bottom: 32px;
  width: 768px;
  margin: 0 auto;
  padding-top: 16px;
  background-color: var(--ds-surface, #fafbfc);
`;

const FormBox = styled.div`
  background: #fff;
  border-radius: 3px;
  padding: 8px 16px 16px 16px;
  box-shadow: var(
    --ds-shadow-overlay,
    0 4px 8px -2px rgba(9, 30, 66, 0.25),
    0 0 1px rgba(9, 30, 66, 0.31)
  );
`;

const StyledTextArea = styled(TextArea)`
  &&:not(:focus) {
    background: none;
  }

  &&:hover:not(:read-only):not(:focus) {
    background: none;
  }

  &&:active {
    background: none;
  }

  &&:not([data-compact]) {
    padding: 0;
  }

  && {
    margin-top: 0;
    border: none;
  }
`;

const ButtonBox = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
`;

const ToolBtnBox = styled.span`
  opacity: 0.6;
  cursor: pointer;
  &:hover {
    opacity: 1;
  }
`;

const MessageSender = ({ onSubmit, placeholder }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [currentPrompt, setCurrentPrompt] = React.useState('');
  const [tokenUsageRatio, setTokenUsageRatio] = React.useState('');

  const inputRef = React.useRef();
  const formRef = React.useRef();
  const handleSelect = (prompt) => {
    inputRef.current.value = prompt;
    setCurrentPrompt(prompt);
    setIsOpen(false);
    resizeTextArea();
  };

  const resizeTextArea = () => {
    inputRef.current.style.height = 'auto';
    const scrollHeight = inputRef.current.scrollHeight;
    inputRef.current.style.height = scrollHeight + 'px';
  };

  const handleInputKeyDown = (event) => {
    // Submit on Enter (without Shift). Use "event.key" and ensure the submit event bubbles so React can handle it.
    if (event.key === 'Enter' && !event.shiftKey) {
      // Prevent default newline insertion in the textarea
      event.preventDefault();
      const formEl = event.target.form || formRef.current;
      if (formEl) {
        // Prefer requestSubmit when available (triggers submit handlers properly)
        if (typeof formEl.requestSubmit === 'function') {
          formEl.requestSubmit();
        } else {
          // Fallback: dispatch a bubbling submit event so React's onSubmit gets called
          formEl.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
      }
    }
  };

  const handleSubmit = async (data, formApi) => {
    console.log('Submitting data:', data);
    if (!data.query) return;
    inputRef.current.value = '';
    setCurrentPrompt('');
    resizeTextArea();
    await onSubmit(data.query || currentPrompt);
    formApi.reset();
  };

  return (
    <ChatSendBox>
      <FormBox>
        <Form onSubmit={handleSubmit}>
          {({ formProps, submitting }) => (
            <form {...formProps} ref={formRef}>
              <Field name="query" defaultValue={currentPrompt}>
                {({ fieldProps }) => (
                  <StyledTextArea
                    ref={inputRef}
                    resize="smart"
                    onKeyDown={handleInputKeyDown}
                    placeholder={placeholder || "e.g. Write a Job Description for Senior DevOps Engineer"}
                    {...fieldProps}
                  />
                )}
              </Field>
              <ButtonBox>
                <Popup
                  isOpen={isOpen}
                  onClose={() => setIsOpen(false)}
                  content={() => <PreDefinedPrompts onSelect={handleSelect} />}
                  placement="bottom-start"
                  trigger={(triggerProps) => (
                    <ToolBtnBox
                      {...triggerProps}
                      onClick={() => setIsOpen(!isOpen)}
                    >
                      <LightbulbFilledIcon label="Predefined prompts" />
                    </ToolBtnBox>
                  )}
                />
                <LoadingButton
                  type="submit"
                  appearance="primary"
                  isLoading={submitting}
                >
                  Submit
                </LoadingButton>
              </ButtonBox>
            </form>
          )}
        </Form>
      </FormBox>
      <HelperMessage>
        Go to{' '}
        <a
          href={`https://github.com/ZenGPT/confluence-gpt/wiki/Crafting-Effective-Prompts`}
          onClick={(e) => {
            e.preventDefault();
            openUrl(`https://github.com/ZenGPT/confluence-gpt/wiki/Crafting-Effective-Prompts`);
          }}
          rel="noreferrer noopener"
        >
          Crafting Effective Prompts
        </a>{' '}
        for more information. Use "Shift + Enter" for new line.
      </HelperMessage>
    </ChatSendBox>
  );
};

export default MessageSender;
