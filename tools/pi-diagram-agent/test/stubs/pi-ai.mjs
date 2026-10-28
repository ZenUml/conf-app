// Minimal stand-in for @earendil-works/pi-ai so pi-extension.ts can be imported without the Pi runtime.
export const Type = {Object: props => ({type: 'object', properties: props}), String: () => ({type: 'string'}), Optional: schema => ({...schema, optional: true})};
