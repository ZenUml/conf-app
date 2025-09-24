// Simple modal service for showing dialogs
let modalContainer: HTMLElement | null = null;
let currentResolve: ((value: string) => void) | null = null;

// Create modal container if it doesn't exist
function createModalContainer() {
  if (!modalContainer) {
    modalContainer = document.createElement('div');
    modalContainer.id = 'zenuml-modal-container';
    modalContainer.style.position = 'fixed';
    modalContainer.style.top = '0';
    modalContainer.style.left = '0';
    modalContainer.style.width = '100%';
    modalContainer.style.height = '100%';
    modalContainer.style.zIndex = '9999';
    modalContainer.style.display = 'none';
    document.body.appendChild(modalContainer);
  }
  return modalContainer;
}

// Show close without saving dialog
export function showCloseWithoutSavingDialog(): Promise<string> {
  return new Promise((resolve) => {
    currentResolve = resolve;
    const container = createModalContainer();
    
    container.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
      ">
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding-top: 30px;
          padding-bottom: 30px;
          border-radius: 4px;
          background-color: #fefefe;
          width: 500px;
        ">
          <p style="
            margin: 0;
            font-family: Arial, sans-serif;
          ">All changes will be lost!</p>
          <div>
            <button id="discard-button" style="
              margin: 10px;
              padding: 6px 14px;
              font-size: 16px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background-color: #f5f5f5;
              color: #333;
              font-family: Arial, sans-serif;
            ">Discard Changes</button>
            <button id="cancel-button" style="
              margin: 10px;
              padding: 6px 14px;
              font-size: 16px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #007bff;
              background-color: #007bff;
              color: white;
              font-family: Arial, sans-serif;
            ">Cancel</button>
          </div>
        </div>
      </div>
    `;
    
    container.style.display = 'block';
    
    // Add event listeners
    const discardButton = container.querySelector('#discard-button');
    const cancelButton = container.querySelector('#cancel-button');
    
    const handleDiscard = () => {
      hideModal();
      resolve('discard');
    };
    
    const handleCancel = () => {
      hideModal();
      resolve('cancel');
    };
    
    const handleOverlayClick = (e: Event) => {
      if (e.target === container.querySelector('div')) {
        handleCancel();
      }
    };
    
    discardButton?.addEventListener('click', handleDiscard);
    cancelButton?.addEventListener('click', handleCancel);
    container.addEventListener('click', handleOverlayClick);
    
    // Store cleanup function
    (container as any).cleanup = () => {
      discardButton?.removeEventListener('click', handleDiscard);
      cancelButton?.removeEventListener('click', handleCancel);
      container.removeEventListener('click', handleOverlayClick);
    };
  });
}

// Hide modal
function hideModal() {
  if (modalContainer) {
    modalContainer.style.display = 'none';
    // Clean up event listeners
    if ((modalContainer as any).cleanup) {
      (modalContainer as any).cleanup();
    }
  }
}
