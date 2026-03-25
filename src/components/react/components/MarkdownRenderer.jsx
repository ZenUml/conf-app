import remarkGfm from 'remark-gfm';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/cjs/prism-light';
import { oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import React, { useRef } from 'react';
import styled from 'styled-components';
import ReactMarkdown from 'react-markdown';
import CopyIcon from '@atlaskit/icon/glyph/copy';
import Button from '@atlaskit/button/standard-button';
import Clipboard from 'clipboard';
import InlineDialog from '@atlaskit/inline-dialog';
import Spinner from '@atlaskit/spinner';

const MarkdownBox = styled.div`
  width: 768px;
  margin: 12px auto;
  display: flex;
  flex-direction: column;
  align-items: ${(props) => (props.$isGPT ? 'flex-end' : 'flex-start')};

  &:hover {
    .chat-footer {
      visibility: visible;
    }
  }
`;

// eslint-disable-next-line no-unused-vars
const StyledMarkdown = styled(
  ({ primaryBg, isGPT, children, className, ...restProps }) => (
    <div className={className}>
      <ReactMarkdown {...restProps}>{children}</ReactMarkdown>
    </div>
  )
)`
  width: auto;
  max-width: 520px;
  border: 1px solid var(--ds-border, #dfe1e6);
  padding: 6px 12px;
  box-sizing: border-box;
  background-color: ${(props) =>
    props.isGPT
      ? 'var(--ds-background-neutral, rgba(9, 30, 66, 0.04))'
      : '#0052CC'};
  margin-bottom: 10px;
  color: ${(props) => (props.isGPT ? 'var(--ds-text, #172b4d)' : '#fff')};
  border-radius: 3px;

  tr {
    border-bottom: 1px solid #eee;
  }

  p {
    font-size: 1em;
    line-height: 1.714;
    font-weight: normal;
    margin-bottom: 0px;
    letter-spacing: -0.005em;
  }
`;

const CodeBlockBox = styled.div`
  position: relative;

  &:hover {
    > button {
      visibility: visible;
    }
  }
`;

const StyledButton = styled(Button)`
  visibility: hidden;
  cursor: pointer;
  position: absolute !important;
  right: 4px;
  top: 6px;
`;

const InlineCode = styled.code`
  background-color: var(--ds-background-neutral, #dfe1e6);
  color: var(--ds-text-subtle, #42526e);
  border-radius: 3px;
  padding: 2px 0.5ch;
`;

const MarkdownFooter = styled.div.attrs({ className: 'chat-footer' })`
  display: flex;
  justify-content: flex-end;
  visibility: hidden;
`;

const CodeBlock = ({ _, inline, className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || '');
  const content = String(children).replace(/\n$/, '');
  const copyBtnRef = useRef();

  const handleCopy = React.useCallback(
    (event) => {
      const clipboard = new Clipboard(copyBtnRef.current, {
        text: () => content,
      });

      clipboard.onClick(event);

      return () => {
        clipboard.destroy();
      };
    },
    [content]
  );

  return !inline && match ? (
    <CodeBlockBox>
      <StyledButton
        onClick={handleCopy}
        ref={copyBtnRef}
        iconBefore={<CopyIcon label="" size="medium" />}
      />
      <SyntaxHighlighter
        {...props}
        style={oneLight}
        language={match[1]}
        PreTag="div"
      >
        {content}
      </SyntaxHighlighter>
    </CodeBlockBox>
  ) : (
    <InlineCode {...props} className={className}>
      {children}
    </InlineCode>
  );
};

const MarkdownRenderer = ({ content, loading, isGPT }) => {
  const hasError = content.startsWith('An error occurred');
  const copyBtnRef = React.useRef();
  const [copied, setCopied] = React.useState(false);

  const handleError = React.useCallback(() => {
    console.warn('Copy failed.');
  }, []);

  const handleSuccess = React.useCallback(() => {
    setCopied(true);
  }, []);

  const handleCopy = React.useCallback(
    (event) => {
      const clipboard = new Clipboard(copyBtnRef.current, {
        text: () => content,
      });

      clipboard.on('success', handleSuccess);

      clipboard.on('error', handleError);

      clipboard.onClick(event);

      return () => {
        clipboard.destroy();
      };
    },
    [content, handleError, handleSuccess]
  );

  return (
    <MarkdownBox $isGPT={isGPT}>
      {loading ? (
        <Spinner />
      ) : (
        <>
          <StyledMarkdown
            isGPT={isGPT}
            chatMode
            remarkPlugins={[remarkGfm]}
            components={{
              code: CodeBlock,
            }}
          >
            {content}
          </StyledMarkdown>
          <MarkdownFooter>
            {content && !hasError && (
              <InlineDialog
                onClose={() => setCopied(false)}
                content="Copied Successful"
                isOpen={copied}
              >
                <Button
                  ref={copyBtnRef}
                  onClick={handleCopy}
                  iconBefore={<CopyIcon label="copy" />}
                />
              </InlineDialog>
            )}
          </MarkdownFooter>
        </>
      )}
    </MarkdownBox>
  );
};

export default MarkdownRenderer;
