// Replace the content of a rich-text (ProseMirror) editor in the vendor console with HTML.
// Use: send this file's text plus one call line to the page's JavaScript tool, for example
//   pasteHtml(0, "<p>...</p><ul><li>...</li></ul>")
// Before the call: click inside the editor and press cmd+a with real input events. A DOM
// range alone does not move the editor's own selection, and the paste then appends.
// index: 0-based position among the page's contenteditable editors (More details is 0,
// Release notes is 1 on the version details page).
// Returns JSON: handled (true = the editor took the paste), textLength, head, tail.
function pasteHtml(index, html) {
  const editor = document.querySelectorAll('[contenteditable="true"]')[index];
  if (!editor) return JSON.stringify({ error: "no editor at index " + index });
  const data = new DataTransfer();
  data.setData("text/html", html);
  data.setData("text/plain", html.replace(/<[^>]+>/g, " "));
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  const handled = !editor.dispatchEvent(event);
  const text = editor.innerText;
  return JSON.stringify({ handled, textLength: text.length, head: text.slice(0, 60), tail: text.slice(-60) });
}
