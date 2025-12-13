// Migration script to update ZenUML macro content IDs on Confluence pages
// Usage: Run this script in the browser console on your Confluence instance
// Old instance: https://blisss.atlassian.net/wiki/home, New instance: https://my-desk.atlassian.net/wiki/home
// Executed on 2025-12-13

let pageId = 689441; 
let migrate = async (pageId) => {
  let page = await (await fetch(`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`)).json();
  let body = JSON.parse(page.body.atlas_doc_format.value);
  let keyRegex = /zenuml-(sequence|graph|openapi|embed)-macro/;
  let check = (c) => c.type === 'extension' && c.attrs.extensionType === 'com.atlassian.confluence.macro.core' && keyRegex.test(c.attrs.extensionKey);
  let traversal = (array, result) => {
    result.push(...(array.filter(check)));
    array.forEach(c => {
      if(c.content) {
        traversal(c.content, result)
      }
    })
  };
  let macros = [];
  let changes = [];
  traversal(body.content, macros);
  if(macros.length === 0) {
    console.log(`No ZenUML macros found on page ${pageId}`);
    return;
  }
  macros.forEach(m => {
    let matched = mapping.find(c => c.oldId == m.attrs.parameters.macroParams.customContentId.value);
    if(matched) {
      changes.push({oldId: m.attrs.parameters.macroParams.customContentId.value, newId: matched.id});
      m.attrs.parameters.macroParams.customContentId.value = matched.id;
    }
  });
  if(changes.length === 0) {
    console.log(`No ZenUML macros to migrate on page ${pageId}`);
    return;
  }
  console.log(`${page._links.base}${page._links.webui}`);
  console.log('Changes:', changes);

  let data = {id: pageId, title: page.title, status: 'current', version: {number: page.version.number + 1, message: `ZenUML macros migration to new content`}, body: {value: JSON.stringify({type: 'doc', content: body.content}), representation: 'atlas_doc_format'}};
  // let data = {id: pageId, title: page.title, status: 'draft', version: {number: 1, message: `ZenUML macros migration to new content`}, body: {value: JSON.stringify({type: 'doc', content: body.content}), representation: 'atlas_doc_format'}};
  return (await (await fetch(`/wiki/api/v2/pages/${pageId}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)})).json());
};

let pages = ['689939', '690587', '690593', '691055', '691682', '691694', '691744', '691777', '691872', '692482', '692650', '693015', '695064', '695507', '695895', '696053', '696069', '696176', '696368', '696676', '697097', '697810', '698271', '701205']; //24 pages
await Promise.all(pages.map(pid => migrate(pid)));


JSON.parse((await (await fetch('/wiki/api/v2/custom-content/2429026366?body-format=raw')).json()).body.raw.value)
(await (await fetch('/wiki/api/v2/pages/2520743937/custom-content?type=ac:com.zenuml.confluence-addon:zenuml-content-sequence&type=ac:com.zenuml.confluence-addon:zenuml-content-graph&body-format=raw')).json()) //25 custom contents, but page content has only 14 macros


(await (await fetch('/wiki/api/v2/pages?limit=250&' + Array.from(new Set((await (await fetch('/wiki/api/v2/custom-content?type=ac:com.zenuml.confluence-addon:zenuml-content-sequence&type=ac:com.zenuml.confluence-addon:zenuml-content-graph&limit=250')).json()).results.map(c => `id=${c.pageId}`))).join('&') )).json() ).results.map(p => ({id: p.id, title: p.title}) )

// Find pages by title in my-desk.atlassian.net
(await Promise.all( ['MyDesk', 'Synchronization.SN', 'Business Central koppeling', 'Externe koppelingen', 'SSW: Importeren SSD', 'Business Central Custom (Groenoord)', 'Proces: Eenmalige facturen maken', 'Proces: Nieuwe klant onboarden', 'Proces: Controle van openstaande facturen', 'Proces: Support uren schrijven en factureren', 'Opzetten lokale omgeving', 'Exchange koppeling', 'Licentie en facturatie wijzigingen', 'Ontwikkelmethodiek', 'BC - algemene informatie voor klant', 'Bestandenbeheer', 'Swagger', 'Request & responses', 'Dagrapport 4', 'Oneflow ontwerp', 'Livegang', 'SSO (Single Sign-On)', 'Architectuur', 'Optie 2', 'Authenticatie', 'AI in MyDesk', 'Afspraak koppelen met AI'].map(async t => (await (await fetch(`/wiki/api/v2/pages?body-format=atlas_doc_format&title=${encodeURIComponent(t)}`)).json() ) ) ) ).flatMap(i => i.results).map(p => p.id)
//['688130', '689441', '689939', '690587', '690593', '691055', '691682', '691694', '691744', '691777', '691872', '692482', '692650', '693015', '695064', '695507', '695895', '696053', '696069', '696176', '696368', '696486', '696676', '697097', '697810', '698271', '701205']
//['688130 MyDesk', '689441 Synchronization.SN', '689939 Business Central koppeling', '690587 Externe koppelingen', '690593 SSW: Importeren SSD', '691055 Business Central Custom (Groenoord)', '691682 Proces: Eenmalige facturen maken', '691694 Proces: Nieuwe klant onboarden', '691744 Proces: Controle van openstaande facturen', '691777 Proces: Support uren schrijven en factureren', '691872 Opzetten lokale omgeving', '692482 Exchange koppeling', '692650 Licentie en facturatie wijzigingen', '693015 Ontwikkelmethodiek', '695064 BC - algemene informatie voor klant', '695507 Bestandenbeheer', '695895 Swagger', '696053 Request & responses', '696069 Dagrapport 4', '696176 Oneflow ontwerp', '696368 Livegang', '696486 SSO (Single Sign-On)', '696676 Architectuur', '697097 Optie 2', '697810 Authenticatie', '698271 AI in MyDesk', '701205 Afspraak koppelen met AI']

const importJS = url => {
  const script = document.createElement('script');
  script.src = url;
  script.type = 'text/javascript';
  document.head.appendChild(script);
};

importJS('https://cdnjs.cloudflare.com/ajax/libs/crypto-js/3.1.9-1/core.js');
importJS('https://cdnjs.cloudflare.com/ajax/libs/crypto-js/3.1.9-1/md5.js');

newdata = (await (await fetch('/wiki/api/v2/custom-content?type=ac:com.zenuml.confluence-addon:zenuml-content-sequence&type=ac:com.zenuml.confluence-addon:zenuml-content-graph&body-format=raw&limit=250')).json()).results.map(c => ({id: c.id, title: c.title, createdAt: c.createdAt, body: CryptoJS.MD5(c.body.raw.value).toString()}))

olddata.map(o => Object.assign( {oldId: o.id, oldCreatedAt: o.createdAt}, newdata.find(c => c.body === o.body && c.title === o.title) ) )

const jsonData = JSON.stringify(changes, null, 2); // Stringify the data with 2-space indentation
const blob = new Blob([jsonData], { type: 'application/json' });
const url = URL.createObjectURL(blob);

const a = document.createElement('a');
a.href = url;
a.download = 'my_data.json'; // Name of the downloaded file
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);