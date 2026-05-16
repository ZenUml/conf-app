// AsyncAPI editor entry — scaffolding for PR #1 of the AsyncAPI variant merge.
// Real Studio-iframe integration lands in PR #2.

function mountPlaceholder() {
  const root = document.getElementById('app')
  if (!root) return
  root.innerHTML = [
    '<div style="font-family: sans-serif; padding: 24px;">',
    '  <h2 style="margin: 0 0 8px;">AsyncAPI editor</h2>',
    '  <p style="color: #6b7280; margin: 0;">Coming soon. PR #1 scaffolding only.</p>',
    '</div>',
  ].join('\n')
}

mountPlaceholder()
