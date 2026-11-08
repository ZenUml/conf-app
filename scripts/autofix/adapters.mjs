/** Service adapters. No credential provisioning, scheduler, or implicit publish.
 * Call only from the trusted controller, never an agent checkout. */
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { publicIssue } from './control.mjs';
const execFile = promisify(execFileCallback);
const SAFE_ID = /^[0-9]+$/;
export async function github(query, variables = {}, run = execFile) {
  // Use argv, never a shell. Only opaque identifiers and reviewed redacted
  // projection fields are allowed here; credentials must never be variables.
  const args = ['api', 'graphql', '--hostname', 'github.com', '-f', `query=${query}`];
  for (const [key,value] of Object.entries(variables)) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || typeof value !== 'string') throw new Error('Invalid GraphQL variable');
    args.push('-f', `${key}=${value}`);
  }
  let result;
  try { result = JSON.parse((await run('gh', args, {timeout: 30000, maxBuffer: 4194304})).stdout); }
  catch { throw new Error('GitHub request failed; reconcile writes before retry'); }
  if (result.errors?.length || !result.data) throw new Error('GitHub returned errors; reconcile writes before retry');
  return result.data;
}

/** An authenticated read with exact service origin; raw events never leave this
 * function. Token is supplied in memory by an already-authorized credential host.
 * API denial, missing release attribution and zero counts remain distinguishable. */
export async function readSentryIssue({token, organization, issueId, allowedProjectIds}, request = fetch) {
  if (!token || !/^[a-z0-9-]+$/.test(organization ?? '') || !SAFE_ID.test(issueId) || !Array.isArray(allowedProjectIds) || !allowedProjectIds.every(id => SAFE_ID.test(id))) throw new Error('Sentry configuration incomplete');
  const url = `https://sentry.io/api/0/organizations/${organization}/issues/${issueId}/`;
  let response;
  try { response = await request(url, {headers: {Authorization:`Bearer ${token}`}, redirect:'error', signal:AbortSignal.timeout(15000)}); }
  catch { throw new Error('Sentry unavailable; observation is inconclusive'); }
  if (!response.ok) throw new Error(`Sentry read failed (${response.status}); observation is inconclusive`);
  // Stream with a hard bound rather than trusting Content-Length.
  let size = 0; let data;
  try {
    const reader = response.body.getReader(); const chunks = [];
    try {
      for (;;) { const {value,done} = await reader.read(); if (done) break;
        size += value.length; if (size > 1048576) throw new Error('Oversize response'); chunks.push(value); }
    } finally { await reader.cancel(); }
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    // Parser and stream errors can contain raw response bytes or credentials.
    // Never propagate the original error, including as a cause.
    throw new Error(size > 1048576 ? 'Oversize Sentry response' : 'Sentry response unreadable; observation is inconclusive');
  }
  if (!data || String(data.id) !== issueId || !allowedProjectIds.includes(String(data.project?.id))) throw new Error('Unexpected Sentry issue/project');
  const count = Number(data.count);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid Sentry count');
  return {issueId, projectId:String(data.project.id), count,
    countScope:'Sentry issue lifetime count; not users or a release observation',
    status:['resolved','unresolved','ignored'].includes(data.status) ? data.status : 'unknown',
    lastSeen: Number.isFinite(Date.parse(data.lastSeen)) ? new Date(data.lastSeen).toISOString() : null,
    observedAt:new Date().toISOString(), releaseAttribution:false};
}

export async function readProject(projectId, api = github) {
  const fields = []; let after = ''; let first;
  do {
    const data = await api(`query($id:ID!,$after:String){node(id:$id){... on ProjectV2{id title url public fields(first:100,after:$after){nodes{__typename ... on ProjectV2Field{id name} ... on ProjectV2SingleSelectField{id name options{id name}}}pageInfo{hasNextPage endCursor}}}}}`, {id:projectId,...(after?{after}:{})});
    if (!data.node || data.node.public !== false) throw new Error('Private project required');
    first ??= data.node; fields.push(...data.node.fields.nodes);
    after = data.node.fields.pageInfo.hasNextPage ? data.node.fields.pageInfo.endCursor : '';
  } while (after);
  return {id:first.id,title:first.title,url:first.url,fields};
}

export function fieldUpdates(project, values) {
  return Object.entries(values).map(([name,value])=>{
    const field = project.fields.find(f=>f.name === name);
    if (!field || field.__typename !== 'ProjectV2SingleSelectField') throw new Error(`Missing select field ${name}`);
    const option = field.options.find(o=>o.name === value);
    if (!option) throw new Error(`Unknown option for ${name}`);
    return {fieldId:field.id,optionId:option.id};
  });
}

/** Idempotent SET operations only. Caller records an effect before invoking and
 * reconciles uncertain outcomes. A field being green is never release authority. */
export async function setProjectSelects(project, itemId, values, api = github) {
  const updates = fieldUpdates(project,values); // Validate entire set first.
  for (const update of updates) {
    // Recheck live visibility before each write, not the earlier field snapshot.
    // GitHub offers no atomic visibility-conditioned mutation: callers must keep
    // this dashboard private for its lifetime, including after a write.
    const item = await api(`query($id:ID!){node(id:$id){... on ProjectV2Item{id project{id public}}}}`,{id:itemId});
    if (item.node?.project?.id !== project.id) throw new Error('Item does not belong to configured project');
    if (item.node.project.public !== false) throw new Error('Private project required');
    await api(`mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}}`,
      {project:project.id,item:itemId,field:update.fieldId,option:update.optionId});
  }
  return updates.length;
}

/** Prepare only. Creating an issue is a separately journaled external effect.
 * No title, request, stack, tenant, or source text is copied into the public repo. */
export function preparePublicIssue(reference) { return publicIssue(reference); }
