/**
 * @param {HTMLElement} dom
 * @param {(mutations: MutationRecord[], observer: MutationObserver) => void} callback
 * @return {void}
 */
export const observeDomChanges = (dom, callback) => {
  const observer = new MutationObserver(callback);
  const config = { attributes: true, childList: true, subtree: true };
  observer.observe(dom, config);
};
