import React from "react";
import { useMacroBody } from "../../common/useMacroBody";
import { ReactRenderer } from "@atlaskit/renderer";
import { Modal } from '@forge/bridge';

export function CustomUIApp() {
  const { htmlBody, macroBody } = useMacroBody();


  useEffect(() => {
    const handleResize = (event) => {
      console.log('handleResize', event);

      if (event.data.type === 'resize' && event.data.height) {
        if (iframeRef.current) {
          iframeRef.current.style.height = `${event.data.height}px`;
        }
      }
    };

    window.addEventListener('message', handleResize);

    return () => {
      window.removeEventListener('message', handleResize);
    };
  }, []);

  // const modal = new Modal({
  //   resource: 'custom-ui-config',
  //   onClose: (payload) => {
  //     console.log('onClose called with', payload);
  //   },
  //   size: 'max',
  //   context: {
  //     customKey: 'custom-value',
  //   },
  // });

  // modal.open();

  return (
    <>
      <h1>Custom UI Forge Macro</h1>
      <iframe ref={iframeRef} id="zenuml-sequence-editor" src="https://yanhui8080.zenuml.com/sequence-editor" width="100%" style={{ border: 'none' }}/>

      <section>
        <p>ADF:</p>
        {macroBody && (
          <div
            style={{
              border: "1px dashed green",
              padding: "10px",
              width: "100%",
            }}
          >
            <ReactRenderer document={macroBody} />
          </div>
        )}
      
      <p>HTML Frame:</p>
        {htmlBody && (
          <iframe
            srcDoc={htmlBody}
            style={{ 
              border: "1px dashed red", 
              padding: "10px", 
              width: "100%" 
            }}
          />
        )}

      </section>
    </>
  );
}

export default CustomUIApp;
