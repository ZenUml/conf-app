// Ported from AsyncAPI-Conf-V2/src/components/editor/AsyncAPIStudioEditor.tsx.
// The Studio is loaded as a nested iframe; same-origin localStorage is the
// sync channel between this wrapper and the Studio runtime, so the Studio
// assets must ship under the same Forge resource as index.html (handled by
// vite.config.mjs's conditional copy step).

import React, { useRef, useEffect, useState } from 'react';

interface AsyncApiStudioEditorProps {
  initialSpec?: string;
  onSpecChange?: (spec: string) => void;
  onSave?: (spec: string) => Promise<void> | void;
  onCancel?: () => void;
  height?: string;
  readOnly?: boolean;
}

class AsyncApiStudioIntegration {
  private iframe: HTMLIFrameElement;
  private onSpecChange?: (spec: string) => void;
  private pollInterval?: ReturnType<typeof setInterval>;
  private lastKnownSpec?: string;

  constructor(iframeElement: HTMLIFrameElement, onSpecChange?: (spec: string) => void) {
    this.iframe = iframeElement;
    this.onSpecChange = onSpecChange;
  }

  public startLocalStoragePolling() {
    this.pollInterval = setInterval(() => {
      try {
        const studioDocument = localStorage.getItem('document');
        if (studioDocument && studioDocument !== this.lastKnownSpec && this.onSpecChange) {
          this.lastKnownSpec = studioDocument;
          this.onSpecChange(studioDocument);
        }
      } catch (error) {
        console.warn('Could not access Studio localStorage:', error);
      }
    }, 1000);
  }

  public setInitialDocument(spec: string): void {
    try {
      localStorage.setItem('document', spec);
      this.lastKnownSpec = spec;
    } catch (error) {
      console.error('Failed to set initial document in localStorage:', error);
    }
  }

  public updateDocument(spec: string): void {
    try {
      localStorage.setItem('document', spec);
      this.lastKnownSpec = spec;
      const currentSrc = this.iframe.src;
      this.iframe.src = currentSrc;
    } catch (error) {
      console.error('Failed to update document in localStorage:', error);
    }
  }

  public saveSpec(): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const currentSpec = localStorage.getItem('document');
        if (currentSpec) {
          resolve(currentSpec);
        } else {
          reject(new Error('No spec found in localStorage'));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        reject(new Error('Failed to access localStorage: ' + msg));
      }
    });
  }

  public destroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }
}

const buildStudioUrl = (readOnly: boolean): string => {
  // Relative path so the Studio loads from the same Forge resource origin
  // as index.html (`*.cdn.prod.atlassian-dev.net/<app-id>/`). The
  // localStorage sync below depends on same-origin access.
  const baseUrl = './asyncapi-studio/index.html';
  if (!readOnly) return baseUrl;
  const params = new URLSearchParams();
  params.set('readOnly', 'true');
  return `${baseUrl}?${params.toString()}`;
};

const AsyncApiStudioEditor: React.FC<AsyncApiStudioEditorProps> = ({
  initialSpec,
  onSpecChange,
  onSave,
  onCancel,
  height = '100vh',
  readOnly = false,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [studioIntegration, setStudioIntegration] = useState<AsyncApiStudioIntegration | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [specSet, setSpecSet] = useState(false);
  const [studioUrl, setStudioUrl] = useState<string>('');

  useEffect(() => {
    if (initialSpec && !specSet) {
      try {
        localStorage.setItem('document', initialSpec);
        setSpecSet(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError('Failed to prepare initial specification: ' + msg);
      }
    }
  }, [initialSpec, specSet]);

  useEffect(() => {
    if (specSet || !initialSpec) {
      setStudioUrl(buildStudioUrl(readOnly));
    }
  }, [specSet, initialSpec, readOnly]);

  useEffect(() => {
    if (!iframeRef.current || !studioUrl) return;
    const integration = new AsyncApiStudioIntegration(iframeRef.current, onSpecChange);
    setStudioIntegration(integration);

    iframeRef.current.onload = () => {
      setIsLoaded(true);
      integration.startLocalStoragePolling();
    };
    iframeRef.current.onerror = () => {
      setError('Failed to load AsyncAPI Studio');
    };

    return () => {
      integration.destroy();
    };
  }, [studioUrl, onSpecChange]);

  const handleSave = async () => {
    if (!studioIntegration || !onSave) return;
    setIsSaving(true);
    try {
      const spec = await studioIntegration.saveSpec();
      const result = onSave(spec);
      if (result && typeof (result as Promise<void>).then === 'function') {
        await result;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve specification';
      setError(msg);
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRetry = () => {
    setError(null);
    setIsLoaded(false);
    setSpecSet(false);
    setStudioUrl('');
    if (initialSpec) {
      localStorage.setItem('document', initialSpec);
      setSpecSet(true);
    }
  };

  if (error) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height, border: '1px solid #DE350B', borderRadius: '4px',
        backgroundColor: '#FFEBE6', color: '#DE350B', flexDirection: 'column',
        gap: '10px', padding: '20px',
      }}>
        <h3 style={{ margin: 0 }}>Error Loading AsyncAPI Studio</h3>
        <p style={{ margin: 0, textAlign: 'center' }}>{error}</p>
        <button
          onClick={handleRetry}
          style={{
            padding: '8px 16px', border: 'none', borderRadius: '4px',
            backgroundColor: '#DE350B', color: 'white', cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (initialSpec && !specSet) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height, fontSize: '16px', color: '#0052CC', flexDirection: 'column', gap: '10px',
      }}>
        <div>Preparing AsyncAPI document…</div>
      </div>
    );
  }

  // Dedicated toolbar above the Studio iframe (rather than absolute-
  // positioned over it) — the Studio renders its own dark header inside
  // the iframe, so overlaying buttons there clashes visually and the
  // buttons end up partly hidden behind Studio's controls. A separate
  // strip with a clear border keeps the host's affordances out of the
  // Studio's chrome.
  const HEADER_HEIGHT = 48;
  const showSave = !!onSave && !readOnly;
  const showCancel = !!onCancel;
  const showToolbar = showSave || showCancel;

  return (
    <div style={{ width: '100%', height, display: 'flex', flexDirection: 'column' }}>
      {showToolbar && (
        <div
          style={{
            flex: `0 0 ${HEADER_HEIGHT}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '0 16px',
            background: '#fff',
            borderBottom: '1px solid #DFE1E6',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            {showCancel && (
              <button
                onClick={onCancel}
                disabled={isSaving}
                style={{
                  padding: '6px 14px',
                  border: '1px solid #DFE1E6',
                  borderRadius: 4,
                  background: '#fff',
                  color: '#42526E',
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
            )}
            {showSave && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                style={{
                  padding: '6px 14px',
                  border: 'none',
                  borderRadius: 4,
                  background: isSaving ? '#A5ADBA' : '#0052CC',
                  color: '#fff',
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  fontSize: 14,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                }}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: '1 1 auto', position: 'relative', minHeight: 0 }}>
        {!isLoaded && studioUrl && (
          <div
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: '#f9f9f9', zIndex: 1, flexDirection: 'column', gap: 10,
            }}
          >
            <div style={{ fontSize: 16, color: '#0052CC' }}>Loading AsyncAPI Studio…</div>
          </div>
        )}

        {studioUrl && (
          <iframe
            ref={iframeRef}
            src={studioUrl}
            width="100%"
            height="100%"
            style={{
              border: 'none',
              opacity: isLoaded ? 1 : 0,
              transition: 'opacity 0.3s',
              display: 'block',
            }}
            title="AsyncAPI Studio"
            allow="clipboard-read; clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}
      </div>
    </div>
  );
};

export default AsyncApiStudioEditor;
