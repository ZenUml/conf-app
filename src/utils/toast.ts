export const toast = (options: {
  message: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
  /** CSS `top` of the toast. Default 20px, which is over the editor's type tabs. */
  top?: string;
}) => {
  const { message, duration = 3000, action, top = '20px' } = options;

  const toast = document.createElement('div');
  toast.setAttribute('data-testid', 'toast');
  // Screen readers announce the message without moving focus (#934).
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.style.position = 'fixed';
  toast.style.top = top;
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.padding = '10px 20px';
  toast.style.borderRadius = '5px';
  toast.style.color = '#fff';
  toast.style.fontSize = '16px';
  toast.style.zIndex = '9999';
  toast.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
  toast.style.transition = 'all 0.3s';

  // The click handler and the timers both remove the node; whichever runs
  // second must find it already gone.
  const remove = () => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  };

  if (action) {
    const text = document.createElement('span');
    text.textContent = message;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-testid', 'toast-action');
    button.textContent = action.label;
    button.style.color = '#fff';
    button.style.background = 'transparent';
    button.style.border = 'none';
    button.style.textDecoration = 'underline';
    button.style.marginLeft = '12px';
    button.style.cursor = 'pointer';
    button.style.fontSize = '16px';
    button.addEventListener('click', () => {
      action.onClick();
      remove();
    });
    toast.appendChild(text);
    toast.appendChild(button);
  } else {
    toast.textContent = message;
  }

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(remove, 300);
  }, duration);
}
