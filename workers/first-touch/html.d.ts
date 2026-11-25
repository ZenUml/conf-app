// wrangler.toml bundles *.html as Text modules.
declare module "*.html" {
  const text: string;
  export default text;
}
