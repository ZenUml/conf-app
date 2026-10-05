// Presentation is supplied by the caller, never inferred from author SVG metadata.
export function resolvePresentation(presentation,viewBox){
  const p=presentation??{mode:'fit',width:1200,height:710};
  if(!p||typeof p!=='object'||!['fit','native'].includes(p.mode))return {error:'presentation mode must be fit or native'};
  const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
  if(p.mode==='native'){
    const scale=p.scale??1;
    return positive(scale)?{mode:'native',scale}:{error:'native presentation scale must be positive and finite'};
  }
  const width=p.width??1200,height=p.height??710;
  if(!positive(width)||!positive(height))return {error:'fit presentation width and height must be positive and finite'};
  if(!viewBox||!positive(viewBox.w)||!positive(viewBox.h))return {error:'the root svg has no usable viewBox, so the page-fit scale cannot be established'};
  return {mode:'fit',width,height,scale:Math.min(width/viewBox.w,height/viewBox.h)};
}
