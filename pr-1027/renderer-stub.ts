export const plantUmlRenderer = async () => (localStorage.getItem('plantumlRenderer') === 'server' ? 'server' : 'local');
