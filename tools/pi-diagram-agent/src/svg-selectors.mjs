// One definition of "a node element" and "a group container element" for every drawn-SVG query.
// A node <g> may carry data-group="<id>" membership metadata; it is never a container, so GROUP_SELECTOR excludes NODE_SELECTOR.
// Browser-side code cannot close over module scope: pass these strings into page.evaluate as arguments.
export const NODE_SELECTOR='g[data-node],g[data-node-id]';
export const GROUP_SELECTOR='g:is([data-group],[data-container-id],[id^="group-"]):not([data-node],[data-node-id])';
