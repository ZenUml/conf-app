const {chromium,expect}=require('/workspace/conf-app-usage-ui/node_modules/@playwright/test');
const fs=require('node:fs');
(async()=>{
 const out='/workspace/artifacts/pr966-review';fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 for(const [version,port] of [['before',6007],['after',6006]]){
  const page=await browser.newPage({viewport:{width:1580,height:1500}});
  const f=page.frameLocator('#storybook-preview-iframe');
  for(const screen of ['usage','request','locations']){
   const story=screen==='locations'?'locations':'default';
   await page.goto(`http://127.0.0.1:${port}/?path=/story/plan-and-usage-planusage--${story}`);
   if(screen==='locations'){
    await expect(f.getByTestId('diagram-locations-range')).toContainText('1–10',{timeout:30000});
    await expect(f.getByTestId('diagram-locations-summary')).toContainText('35');
    await expect(f.getByText('Restricted design')).toHaveCount(0);
   }else{
    await expect(f.getByTestId('plan-usage-view-locations')).toBeVisible({timeout:30000});
    if(screen==='request'){await f.getByRole('button',{name:'Request Full',exact:true}).click();await expect(f.getByRole('button',{name:'Copy reason',exact:true})).toBeVisible();}
   }
   await page.locator('#storybook-preview-iframe').screenshot({path:`${out}/${version}-${screen}.png`});
   console.log(`PASS ${version} ${screen}`);
  }
  await page.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
