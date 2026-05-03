import { OkResponse } from "../OkResponse";
import { queryUserLikesInDomain } from "./query";
export interface Env {
  DB: D1Database;
}
export const onRequest = async ({ request, env }) => {

  if ('POST' === request.method) {
    const body: any = await request.json();
    console.log('req body:', body);
    const result = await queryUserLikesInDomain(env, body);
    console.log('run result:', JSON.stringify(result));
    return result;
  }

  return OkResponse();
};
