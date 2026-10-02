import {describe,it,expect,vi} from 'vitest';
import {provisionParentFixture} from '../e2e-tests/helpers/parentFixture';
import {APP_PROFILES} from '../e2e-tests/config/apps';
const config=()=>({domain:'example.atlassian.net',spaceKey:'TEST',parentPageId:'',parentPageName:'',productType:'asyncapi',isProd:false});
const response=(data:unknown,ok=true)=>({ok:()=>ok,status:()=>ok?200:403,json:async()=>data});
const request=()=>({get:vi.fn().mockResolvedValue(response({results:[{id:'space',key:'TEST'}]})),post:vi.fn().mockResolvedValue(response({id:'parent'}))});
describe('AsyncAPI shared OpenAPI fixtures',()=>{
 it('enables OpenAPI insertion and render coverage',()=>{expect(APP_PROFILES['asyncapi@stg'].macros).toEqual(['openapi']);expect(APP_PROFILES['asyncapi@stg'].renderMacros).toEqual(['openapi']);});
 it('provisions a parent and retains it for subsequent editor helpers',async()=>{const c=config(),r=request();await provisionParentFixture(r as any,c);expect(c.parentPageId).toBe('parent');expect(r.post.mock.calls[0][1].data.spaceId).toBe('space');await provisionParentFixture(r as any,c);expect(r.post).toHaveBeenCalledTimes(1);});
 it('preserves existing profiles and refuses parent provisioning in production',async()=>{const r=request();await provisionParentFixture(r as any,{...config(),productType:'lite',parentPageId:'existing'});expect(r.get).not.toHaveBeenCalled();await expect(provisionParentFixture(r as any,{...config(),isProd:true})).rejects.toThrow('configured');expect(r.post).not.toHaveBeenCalled();});
 it('discovers an accessible space when the configured fallback key is absent',async()=>{const r=request(),c=config();r.get.mockResolvedValueOnce(response({results:[]})).mockResolvedValueOnce(response({results:[{id:'other',key:'AVAILABLE'}]}));await provisionParentFixture(r as any,c);expect(c.spaceKey).toBe('AVAILABLE');expect(r.get).toHaveBeenCalledTimes(2);});
 it('fails clearly on denied access or missing spaces without creating a page',async()=>{const r=request();r.get.mockResolvedValue(response({},false));await expect(provisionParentFixture(r as any,config())).rejects.toThrow('403');expect(r.post).not.toHaveBeenCalled();});
 it('does not mutate configuration if page provisioning fails',async()=>{const r=request(),c=config();r.post.mockResolvedValue(response({},false));await expect(provisionParentFixture(r as any,c)).rejects.toThrow('creation failed');expect(c.parentPageId).toBe('');});
});
