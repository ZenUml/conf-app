#!/bin/bash
set -eu
port="$1"
variant="$2"
A(){ /usr/local/bin/agent-browser --session "caret-$variant" "$@"; }
A open "http://localhost:$port/iframe.html?id=editor-diagram-mermaidinlineedit--try-by-hand&viewMode=story"
A set viewport 1440 900
A wait '.mie-enabled'
for diagram in sequence flow; do
  if [ "$diagram" = sequence ]; then
    A eval 'window.__mieStore.commit("updateMermaidCode","sequenceDiagram\n  Alice->>Bob: Review\n  Bob->>Alice: Review"); true'
  else
    A eval 'window.__mieStore.commit("updateMermaidCode","flowchart LR\n  A[Review] --> B[Review]"); true'
  fi
  A wait --fn 'document.querySelector(".mie-enabled") && [...document.querySelectorAll("[data-seq-for], .nodeLabel p")].filter(el=>el.textContent==="Review").length===2 && document.querySelector(".cm-content").innerText.includes("Review")'
  A eval '(()=>{const v=document.querySelector(".cm-content").cmTile.root.view;v.focus();const pos=v.state.doc.toString().lastIndexOf("Review")+2;v.dispatch({selection:{anchor:pos}});return {empty:v.state.selection.main.empty,focus:v.hasFocus}})()'
  if [ "$variant" = after ]; then A wait '.mie-source-ring'; fi
  A eval 'JSON.stringify({ring:!!document.querySelector(".mie-source-ring"),hint:!!document.querySelector(".mie-source-hint"),build:document.body.innerText.match(/(?:HEAD|main|codex)[^\n]*@[^\n]*/)?.[0]})'
  A screenshot "/tmp/mermaid-caret-evidence/$variant-$diagram.png"
done
A close
