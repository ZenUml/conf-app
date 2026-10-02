// Synthetic fixtures only. Each group of tests covers one parser feature; every parse goes through ok() so a missing feature fails on an assertion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMermaid} from '../src/parser.mjs';

const ok=src=>{let m;assert.doesNotThrow(()=>{m=parseMermaid(src)});return m};
const unsupported=(src,line,construct)=>{
  assert.throws(()=>parseMermaid(src),e=>{
    assert.match(e.message,new RegExp(`^PARSE_UNSUPPORTED line ${line}: `),e.message);
    assert.ok(e.message.toLowerCase().includes(construct.toLowerCase()),`construct ${construct} in: ${e.message}`);
    return true;
  });
};
const node=(m,id)=>m.nodes.find(n=>n.id===id);
const pairs=m=>m.edges.map(e=>`${e.source}>${e.target}`);

// --- 1. directions ---
test('direction TD is accepted and normalised to TB',()=>{
  const m=ok('flowchart TD\n  A --> B');
  assert.equal(m.direction,'TB');
});
test('graph TD, TB, BT, RL, LR and a bare header are accepted; lowercase is not Mermaid syntax',()=>{
  assert.equal(ok('graph TD\nA-->B').direction,'TB');
  assert.equal(ok('graph BT\nA-->B').direction,'BT');
  assert.equal(ok('flowchart RL\nA-->B').direction,'RL');
  assert.equal(ok('graph\nA-->B').direction,'TB');
  unsupported('flowchart td\nA-->B',1,'direction');
});
test('direction symbols follow Mermaid: > is LR, < is RL, ^ is BT, v is TB',()=>{
  assert.equal(ok('flowchart >\nA-->B').direction,'LR');
  assert.equal(ok('flowchart <\nA-->B').direction,'RL');
  assert.equal(ok('flowchart ^\nA-->B').direction,'BT');
  assert.equal(ok('flowchart v\nA-->B').direction,'TB');
});
test('a header followed by a semicolon statement on the same line parses the statement',()=>{
  const m=ok('graph TD; A-->B; B-->C');
  assert.deepEqual(pairs(m),['A>B','B>C']);
});

// --- 2. edge labels and styles ---
test('pipe labels, with and without quotes, on solid edges',()=>{
  const m=ok('flowchart LR\n  A -->|yes| B\n  B -->|"no, really"| C\n  C-->|x y|D');
  assert.deepEqual(m.edges.map(e=>e.label),['yes','no, really','x y']);
  assert.ok(m.edges.every(e=>e.style==='solid'&&!e.thick));
});
test('inline text labels: -- text --> and -- "text" -->',()=>{
  const m=ok('flowchart LR\n  A -- go on --> B\n  B -- "quoted one" --> C');
  assert.deepEqual(m.edges.map(e=>e.label),['go on','quoted one']);
  assert.deepEqual(pairs(m),['A>B','B>C']);
});
test('dashed edges: -.->, -.->|text|, -.text.->',()=>{
  const m=ok('flowchart LR\n  A -.-> B\n  B -.->|pipe| C\n  C -.inline text.-> D\n  D -. spaced .-> E');
  assert.deepEqual(m.edges.map(e=>[e.style,e.label]),[['dashed',''],['dashed','pipe'],['dashed','inline text'],['dashed','spaced']]);
});
test('thick edges keep a thick flag and stay solid: ==>, ==>|text|, == text ==>',()=>{
  const m=ok('flowchart LR\n  A ==> B\n  B ==>|heavy| C\n  C == inline ==> D');
  assert.deepEqual(m.edges.map(e=>[e.style,e.thick,e.label]),[['solid',true,''],['solid',true,'heavy'],['solid',true,'inline']]);
});
test('longer arrows --->, open links ---, circle --o and cross --x keep their arrow kind; bidirectional is flagged',()=>{
  const m=ok('flowchart LR\n  A ---> B\n  B --- C\n  C --o D\n  D --x E\n  E <--> F');
  assert.deepEqual(m.edges.map(e=>e.arrow),['normal','none','circle','cross','normal']);
  assert.deepEqual(m.edges.map(e=>!!e.bidirectional),[false,false,false,false,true]);
  assert.equal(m.notCheckable.length,4,'open/circle/cross/bidirectional relations are not checkable by the auditor');
  assert.ok(m.notCheckable.every(c=>typeof c.construct==='string'&&Number.isInteger(c.line)));
});

// --- 3. classes and shapes ---
test(':::class on declarations and references becomes the node role, as data',()=>{
  const m=ok('flowchart LR\n  classDef hot fill:#fdd,stroke:#a00,color:#300\n  classDef cool fill:#ddf,stroke:#00a\n  A[Alpha]:::hot --> B([Beta]):::cool\n  B --> A:::cool');
  assert.equal(node(m,'A').text,'Alpha');
  assert.equal(node(m,'A').role,'cool','later class application wins');
  assert.deepEqual(node(m,'A').classes,['hot','cool']);
  assert.equal(node(m,'B').role,'cool');
  assert.equal(m.palette.hot.fill,'#fdd');
  assert.equal(m.palette.cool.stroke,'#00a');
});
test('class statement assigns roles to a comma list; classDef may come after use and may omit stroke',()=>{
  const m=ok('flowchart LR\n  A --> B --> C\n  class A,B warm\n  classDef warm fill:#fed');
  assert.equal(node(m,'A').role,'warm');
  assert.equal(node(m,'B').role,'warm');
  assert.equal(node(m,'C').role,'neutral');
  assert.equal(m.palette.warm.fill,'#fed');
  assert.ok(m.palette.warm.stroke);
});
test('a class name without classDef is kept as the role with a neutral palette entry',()=>{
  const m=ok('flowchart LR\n  A:::ghost --> B');
  assert.equal(node(m,'A').role,'ghost');
  assert.ok(m.palette.ghost);
});
test('classDef values containing commas inside parentheses are not split',()=>{
  const m=ok('flowchart LR\n  classDef c fill:rgb(1,2,3),stroke:#000\n  A:::c');
  assert.equal(m.palette.c.fill,'rgb(1,2,3)');
  assert.equal(m.palette.c.stroke,'#000');
});
test('every Mermaid flowchart node shape maps to the package vocabulary',()=>{
  const cases=[
    ['A[t]','rect'],['A(t)','capsule'],['A([t])','stadium'],['A[[t]]','subroutine'],['A[(t)]','cylinder'],
    ['A((t))','circle'],['A(((t)))','doublecircle'],['A{t}','diamond'],['A{{t}}','hexagon'],['A>t]','asymmetric'],
    ['A[/t/]','parallelogram'],['A[\\t\\]','parallelogram_alt'],['A[/t\\]','trapezoid'],['A[\\t/]','trapezoid_alt'],
  ];
  for(const [decl,shape] of cases){
    const m=ok(`flowchart LR\n  ${decl} --> B`);
    assert.equal(node(m,'A').shape,shape,decl);
    assert.equal(node(m,'A').text,'t',decl);
  }
});
test('quoted node text may hold brackets, parentheses and pipes; <br> becomes a newline; entities decode',()=>{
  const m=ok('flowchart LR\n  A["a [x] (y) | z"] --> B["l1<br/>l2 &amp; l3"]\n  C(["stadium text"]) --> D');
  assert.equal(node(m,'A').text,'a [x] (y) | z');
  assert.equal(node(m,'B').text,'l1\nl2 & l3');
  assert.equal(node(m,'C').shape,'stadium');
  assert.equal(node(m,'C').text,'stadium text');
});
test('node text may continue over several physical lines',()=>{
  const m=ok('flowchart LR\n  A[first line\nsecond line] --> B');
  assert.equal(node(m,'A').text,'first line\nsecond line');
});
test('formatting tags (b, i, code, span ...) keep their text and are recorded as markup; nothing is executed',()=>{
  const m=ok('flowchart LR\n  A["<b>bold</b> and <code>x</code><span style=\'color:red\'>y</span>"] --> B[<i>it</i>]\n  A -->|<b>lbl</b>| B');
  assert.equal(node(m,'A').text,'bold and xy');
  assert.deepEqual(node(m,'A').markup,['b','code','span']);
  assert.equal(node(m,'B').text,'it');
  assert.deepEqual(node(m,'B').markup,['i']);
  assert.equal(m.edges[1].label,'lbl');
});
test('other HTML in labels is refused by name, never executed or stripped silently',()=>{
  unsupported('flowchart LR\n  A["<script>x()</script>"] --> B',2,'html');
  unsupported('flowchart LR\n  A["<a href=\'u\'>l</a>"] --> B',2,'html');
  unsupported('flowchart LR\n  A -->|<img src=x>| B',2,'html');
  unsupported('flowchart LR\n  subgraph S ["<iframe>"]\n  A\n  end',2,'html');
});
test('the @{ } node attribute syntax is refused by name',()=>{
  unsupported('flowchart LR\n  A --> B\n  C@{ shape: cyl }',3,'@{');
});

// --- 4. subgraphs ---
test('nested subgraphs give every node a membership path, outer first',()=>{
  const m=ok(['flowchart TB','  subgraph OUTER [Outer box]','    A[Top]','    subgraph INNER ["Inner box"]','      direction LR','      B[Deep] --> C[Deeper]','    end','    A --> B','  end','  D[Free] --> A'].join('\n'));
  assert.deepEqual(node(m,'A').groupPath,['OUTER']);
  assert.deepEqual(node(m,'B').groupPath,['OUTER','INNER']);
  assert.deepEqual(node(m,'C').groupPath,['OUTER','INNER']);
  assert.deepEqual(node(m,'D').groupPath,[]);
  assert.equal(node(m,'B').group,'INNER','group stays the innermost group for existing consumers');
  assert.equal(node(m,'D').group,null);
  assert.deepEqual(m.groups.map(g=>[g.id,g.label,g.parent,g.direction]),[['OUTER','Outer box',null,null],['INNER','Inner box','OUTER','LR']]);
});
test('subgraph header forms: id, id[title], id ["title"], "title" and multi-word title',()=>{
  const m=ok(['flowchart TB','  subgraph S1','  A','  end','  subgraph S2 [Two words]','  B','  end','  subgraph S3 ["Quoted (title)"]','  C','  end','  subgraph "Just a title"','  D','  end','  subgraph Plain words here','  E','  end'].join('\n'));
  assert.deepEqual(m.groups.map(g=>g.label),['S1','Two words','Quoted (title)','Just a title','Plain words here']);
  assert.deepEqual(m.groups.slice(0,3).map(g=>g.id),['S1','S2','S3']);
  assert.ok(m.groups.slice(3).every(g=>/^subGraph\d+$/.test(g.id)),'untitled-id subgraphs get Mermaid generated ids');
  assert.equal(new Set(m.groups.map(g=>g.id)).size,5);
});
test('declared membership: a node defined with text in a subgraph stays there when a later subgraph only references it',()=>{
  const m=ok('flowchart TB\n  subgraph ONE\n    A[Alpha]\n  end\n  subgraph TWO\n    B[Beta]\n    A --> B\n  end');
  assert.deepEqual(node(m,'A').groupPath,['ONE']);
  assert.deepEqual(node(m,'B').groupPath,['TWO']);
});
test('Mermaid placement is reported separately: the first completed subgraph that references a node owns it',()=>{
  const m=ok('flowchart TB\n  X[Outside]\n  subgraph ONE\n    A[Alpha]\n  end\n  subgraph TWO\n    X --> A\n  end');
  assert.deepEqual(node(m,'X').groupPath,[],'declared outside any subgraph');
  assert.deepEqual(node(m,'X').mermaidGroupPath,['TWO'],'but Mermaid renders it inside TWO');
  assert.deepEqual(node(m,'A').mermaidGroupPath,['ONE']);
});
test('a node only referenced inside a subgraph is declared there',()=>{
  const m=ok('flowchart TB\n  subgraph S\n    A --> B\n  end\n  B --> C');
  assert.deepEqual(node(m,'A').groupPath,['S']);
  assert.deepEqual(node(m,'B').groupPath,['S']);
  assert.deepEqual(node(m,'C').groupPath,[]);
});
test('edges to and from subgraph ids are group-endpoint edges, not nodes',()=>{
  const m=ok('flowchart TB\n  A --> S\n  subgraph S\n    B\n  end\n  S -->|out| C\n  S --> S2\n  subgraph S2\n    D\n  end');
  assert.deepEqual(m.nodes.map(n=>n.id).sort(),['A','B','C','D']);
  assert.deepEqual(pairs(m),[]);
  assert.deepEqual(m.groupEdges.map(e=>[e.source,e.sourceIsGroup,e.target,e.targetIsGroup,e.label]),[['A',false,'S',true,''],['S',true,'C',false,'out'],['S',true,'S2',true,'']]);
  assert.ok(m.notCheckable.some(c=>/group/i.test(c.construct)));
});
test('invisible links are layout hints: kept as layoutLinks between subgraphs and between nodes, never as relations',()=>{
  const m=ok('flowchart LR\n  subgraph S1\n  A\n  end\n  subgraph S2\n  B\n  end\n  S1 ~~~ S2\n  A ~~~ B\n  B ~~~~ C');
  assert.deepEqual([m.edges.length,m.groupEdges.length],[0,0]);
  assert.deepEqual(m.layoutLinks.map(l=>[l.source,l.target,l.sourceIsGroup,l.targetIsGroup]),[['S1','S2',true,true],['A','B',false,false],['B','C',false,false]]);
  assert.deepEqual(m.nodes.map(n=>n.id).sort(),['A','B','C']);
});
test('unclosed, unmatched and a node/subgraph id collision are refused with line numbers',()=>{
  unsupported('flowchart TB\n  subgraph S\n  A',2,'unclosed');
  unsupported('flowchart TB\n  A\n  end',3,'end');
  unsupported('flowchart TB\n  subgraph S\n  A\n  end\n  S[Oops] --> A',5,'subgraph id');
});

// --- 5. chains, fan-out, comments, ignorable lines ---
test('chained edges A --> B --> C produce one edge per link with each label',()=>{
  const m=ok('flowchart LR\n  A -->|one| B -- two --> C -.-> D');
  assert.deepEqual(m.edges.map(e=>[e.source,e.target,e.label,e.style]),[['A','B','one','solid'],['B','C','two','solid'],['C','D','','dashed']]);
});
test('A & B --> C & D expands to the full cross product in order',()=>{
  const m=ok('flowchart LR\n  A & B --> C & D');
  assert.deepEqual(pairs(m),['A>C','A>D','B>C','B>D']);
  assert.deepEqual(m.nodes.map(n=>n.id),['A','B','C','D']);
});
test('comments, init directives, style, linkStyle, click and accessibility lines are ignored; nodes and edges are kept',()=>{
  const m=ok(['%%{init: {"theme":"neutral"}}%%','flowchart LR','  %% a comment','  A[One] --> B[Two]','  style A fill:#f9f,stroke:#333,stroke-width:4px','  linkStyle 0 stroke:#ff3,stroke-width:4px','  click A "https://example.invalid" "tip"','  click B callback','  accTitle: A title','  accDescr: A description'].join('\n'));
  assert.deepEqual(m.nodes.map(n=>n.id),['A','B']);
  assert.deepEqual(pairs(m),['A>B']);
});
test('an inline edge label may continue over a line break, as Mermaid lexes it',()=>{
  const m=ok('flowchart LR\n  A -- first part\n  second part --> B\n  B ==  heavy\n  text ==> C');
  assert.deepEqual(m.edges.map(e=>e.label),['first part second part','heavy text']);
  assert.deepEqual(pairs(m),['A>B','B>C']);
});
test('bidirectional edges with inline text: <-- text --> and <-. text .->',()=>{
  const m=ok('flowchart LR\n  A <-- both --> B\n  B <-. sync .-> C');
  assert.deepEqual(m.edges.map(e=>[e.style,e.label,e.bidirectional]),[['solid','both',true],['dashed','sync',true]]);
});
test('IDs may start with digits, contain hyphens between word characters, and non-ASCII letters',()=>{
  const m=ok('flowchart LR\n  1st-step --> step_2 --> Über');
  assert.deepEqual(m.nodes.map(n=>n.id),['1st-step','step_2','Über']);
});
test('semicolons separate statements but not entities inside labels',()=>{
  const m=ok('flowchart LR\n  A[x &amp; y]-->B;B-->|a &amp; b|C');
  assert.deepEqual(pairs(m),['A>B','B>C']);
  assert.equal(m.edges[1].label,'a & b');
});
test('unsupported syntax names the construct and the line',()=>{
  unsupported('flowchart LR\n  A --> B\n  A e1@--> B',3,'edge id');
  unsupported('flowchart LR\n  A ??? B',2,'syntax');
  unsupported('flowchart LR\n  A --> ',2,'edge');
  unsupported('sequenceDiagram\n  A->>B: hi',1,'diagram type');
});

// --- 6. front matter ---
test('YAML front matter: title becomes the diagram title, config is ignored, line numbers still count it',()=>{
  const src='---\ntitle: My title\nconfig:\n  layout: elk\n  elk:\n    mergeEdges: false\n---\nflowchart TD\n  A --> B';
  const m=ok(src);
  assert.equal(m.title,'My title');
  assert.equal(m.direction,'TB');
  assert.deepEqual(pairs(m),['A>B']);
  unsupported(src+'\n  A ???',10,'syntax');
});
test('front matter without a title leaves title null; an unterminated block is refused',()=>{
  assert.equal(ok('---\nconfig:\n  theme: dark\n---\ngraph LR\nA-->B').title,null);
  assert.equal(ok('graph LR\nA-->B').title,null);
  unsupported('---\ntitle: x\ngraph LR\nA-->B',1,'front matter');
});
