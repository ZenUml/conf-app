// "Close without saving?" dialog for the macro editors (forgeIndex.ts,
// forge-swagger-editor.ts). Plain DOM because it runs before and outside any
// Vue app; #934 tracks moving it onto useModalDialog (#909).
export type CloseWithoutSavingChoice = 'discard' | 'cancel';

const MESSAGE_ID = 'zenuml-modal-message';

let modalContainer: HTMLElement | null = null;
let openDialog: Promise<CloseWithoutSavingChoice> | null = null;

function createModalContainer(): HTMLElement {
  // A container detached by someone else's DOM reset would never show again.
  if (!modalContainer?.isConnected) {
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

/**
 * Resolves 'discard' or 'cancel'. Escape and an overlay click cancel. Calling
 * it while the dialog is open returns the same promise, so every caller settles.
 */
export function showCloseWithoutSavingDialog(): Promise<CloseWithoutSavingChoice> {
  if (openDialog) return openDialog;

  openDialog = new Promise((resolve) => {
    const container = createModalContainer();
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

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
        <div role="dialog" aria-modal="true" aria-labelledby="${MESSAGE_ID}" style="
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
          <p id="${MESSAGE_ID}" style="
            margin: 0;
            font-family: Arial, sans-serif;
          ">All changes will be lost!</p>
          <div>
            <button type="button" id="discard-button" style="
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
            <button type="button" id="cancel-button" style="
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

    const overlay = container.firstElementChild as HTMLElement;
    const discardButton = container.querySelector<HTMLButtonElement>('#discard-button')!;
    const cancelButton = container.querySelector<HTMLButtonElement>('#cancel-button')!;
    const focusable = [discardButton, cancelButton];

    const close = (choice: CloseWithoutSavingChoice) => {
      discardButton.removeEventListener('click', onDiscard);
      cancelButton.removeEventListener('click', onCancel);
      container.removeEventListener('click', onOverlayClick);
      container.removeEventListener('keydown', onKeydown);
      container.style.display = 'none';
      openDialog = null;
      if (opener?.isConnected) opener.focus();
      resolve(choice);
    };
    const onDiscard = () => close('discard');
    const onCancel = () => close('cancel');
    const onOverlayClick = (e: Event) => {
      if (e.target === overlay) close('cancel');
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close('cancel');
      } else if (e.key === 'Tab') {
        // Two buttons: Tab and Shift+Tab both move to the other one.
        e.preventDefault();
        const next = focusable.indexOf(document.activeElement as HTMLButtonElement) === 0 ? 1 : 0;
        focusable[next].focus();
      }
    };

    discardButton.addEventListener('click', onDiscard);
    cancelButton.addEventListener('click', onCancel);
    container.addEventListener('click', onOverlayClick);
    container.addEventListener('keydown', onKeydown);
    // Cancel is the safe default: Enter right after opening keeps the work.
    cancelButton.focus();
  });
  return openDialog;
}
