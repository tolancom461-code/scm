import { describe,expect,it,vi,beforeEach } from 'vitest';
vi.mock('./db',()=>({deleteSession:vi.fn()}));
import {deleteSession} from './db';
import {authRouter} from './modules/auth/router';
import {router} from './_core/trpc';
import {LOCAL_SESSION_COOKIE} from './localAuth';
import type {TrpcContext} from './_core/context';
describe('local session logout',()=>{
 beforeEach(()=>vi.clearAllMocks());
 const caller=(cookie='')=>{const clearCookie=vi.fn();return {clearCookie,api:router({auth:authRouter}).createCaller({user:null,req:{headers:{cookie},protocol:'http'},res:{clearCookie}} as unknown as TrpcContext)};};
 it('revokes the actual token and clears the local cookie',async()=>{const {api,clearCookie}=caller(`${LOCAL_SESSION_COOKIE}=test-token`);expect(await api.auth.logout()).toEqual({success:true});expect(deleteSession).toHaveBeenCalledWith('test-token');expect(clearCookie).toHaveBeenCalledWith(LOCAL_SESSION_COOKIE,{httpOnly:true,path:'/',sameSite:'lax',secure:false});});
 it('allows logout without an existing session',async()=>{const {api,clearCookie}=caller();await api.auth.logout();expect(deleteSession).not.toHaveBeenCalled();expect(clearCookie).toHaveBeenCalledTimes(1);});
});
