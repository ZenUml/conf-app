<template>
  <aside class="dc-panel" data-testid="diagram-comments-panel" aria-label="Diagram comments">
    <header class="dc-header">
      <h2 class="dc-title" data-testid="diagram-comments-title">Comments · {{ threads.length }}</h2>
      <button
        type="button"
        class="dc-close"
        data-testid="diagram-comments-close"
        aria-label="Close comments"
        @click="onClose"
      >
        &times;
      </button>
    </header>

    <div class="dc-body">
      <p v-if="state === 'loading'" class="dc-status" data-testid="diagram-comments-loading" role="status">
        Loading comments…
      </p>

      <div v-else-if="state === 'error'" class="dc-status dc-status--error" data-testid="diagram-comments-error" role="alert">
        <p>{{ loadErrorMessage }}</p>
        <button type="button" class="dc-button dc-button--secondary" data-testid="diagram-comments-retry" @click="load()">
          Retry
        </button>
      </div>

      <div v-else-if="threads.length === 0" class="dc-empty" data-testid="diagram-comments-empty">
        <p class="dc-empty-title">No discussion yet</p>
        <p class="dc-empty-hint">Ask a question or leave a note for this diagram's author.</p>
      </div>

      <ul v-else class="dc-threads" data-testid="diagram-comments-list">
        <li v-for="thread in threads" :key="thread.root.id" class="dc-thread" data-testid="diagram-comments-thread">
          <article class="dc-comment" data-testid="diagram-comments-comment">
            <span class="dc-avatar" aria-hidden="true">{{ initials(thread.root.authorId) }}</span>
            <div class="dc-comment-main">
              <div class="dc-meta">
                <span class="dc-author">{{ nameOf(thread.root.authorId) }}</span>
                <time v-if="thread.root.createdAt" class="dc-time">{{ formatTime(thread.root.createdAt) }}</time>
              </div>
              <p v-if="thread.root.diagramVersion !== undefined" class="dc-version">
                Posted on diagram v{{ thread.root.diagramVersion }}
              </p>
              <p class="dc-text">{{ thread.root.text }}</p>
            </div>
          </article>

          <ul v-if="thread.replies.length" class="dc-replies">
            <li v-for="reply in thread.replies" :key="reply.id">
              <article class="dc-comment" data-testid="diagram-comments-comment">
                <span class="dc-avatar dc-avatar--small" aria-hidden="true">{{ initials(reply.authorId) }}</span>
                <div class="dc-comment-main">
                  <div class="dc-meta">
                    <span class="dc-author">{{ nameOf(reply.authorId) }}</span>
                    <time v-if="reply.createdAt" class="dc-time">{{ formatTime(reply.createdAt) }}</time>
                  </div>
                  <p v-if="reply.diagramVersion !== undefined" class="dc-version">
                    Posted on diagram v{{ reply.diagramVersion }}
                  </p>
                  <p class="dc-text">{{ reply.text }}</p>
                </div>
              </article>
            </li>
          </ul>

          <template v-if="!readOnly">
            <button
              v-if="replyOpenFor !== thread.root.id"
              type="button"
              class="dc-link-button"
              data-testid="diagram-comments-reply-toggle"
              @click="openReply(thread.root.id)"
            >
              Reply
            </button>
            <div v-else class="dc-compose dc-compose--reply" data-testid="diagram-comments-reply-box">
              <textarea
                v-model="replyDrafts[thread.root.id]"
                class="dc-textarea"
                data-testid="diagram-comments-reply-input"
                aria-label="Write a reply"
                rows="2"
                :disabled="posting"
                @keydown.esc.stop
                @keydown.enter="onEnter($event, { kind: 'reply', thread })"
              ></textarea>
              <p class="dc-notify" data-testid="diagram-comments-reply-notify">{{ notifyLine(replyRecipients(thread)) }}</p>
              <p v-if="postNotice?.target === thread.root.id" class="dc-error" role="alert" data-testid="diagram-comments-post-error">
                {{ postNotice.message }}
              </p>
              <div class="dc-actions">
                <button type="button" class="dc-button dc-button--secondary" :disabled="posting" @click="replyOpenFor = null">
                  Cancel
                </button>
                <button
                  type="button"
                  class="dc-button"
                  data-testid="diagram-comments-reply-post"
                  :disabled="posting || !(replyDrafts[thread.root.id] ?? '').trim()"
                  @click="submit({ kind: 'reply', thread })"
                >
                  Post
                </button>
              </div>
            </div>
          </template>
        </li>
      </ul>
    </div>

    <footer class="dc-footer">
      <p v-if="readOnly" class="dc-readonly" data-testid="diagram-comments-readonly">
        You can read this discussion but do not have permission to comment.
      </p>
      <div v-else-if="state !== 'error'" class="dc-compose" data-testid="diagram-comments-compose">
        <textarea
          v-model="rootDraft"
          class="dc-textarea"
          data-testid="diagram-comments-input"
          aria-label="Write a comment"
          placeholder="Ask a question or leave a note"
          rows="3"
          :disabled="posting"
          @keydown.esc.stop
          @keydown.enter="onEnter($event, { kind: 'root' })"
        ></textarea>
        <p class="dc-notify" data-testid="diagram-comments-notify">{{ notifyLine(rootRecipients) }}</p>
        <p v-if="postNotice?.target === ROOT" class="dc-error" role="alert" data-testid="diagram-comments-post-error">
          {{ postNotice.message }}
        </p>
        <div class="dc-actions">
          <button
            type="button"
            class="dc-button"
            data-testid="diagram-comments-post"
            :disabled="posting || !rootDraft.trim()"
            @click="submit({ kind: 'root' })"
          >
            Post
          </button>
        </div>
      </div>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import type { DiagramCommentFailureReason, MacroTypeValue } from '@/utils/analytics/catalog'
import type { AnalyticsProperties } from '@/utils/analytics/types'
import { requestConfluenceJson } from '@/utils/byline/confluenceRequest'
import { buildCommentLink } from './commentLink'
import {
  DiagramCommentError,
  fetchReplies,
  fetchUserNames,
  postFooterComment,
  type CommentRequest,
  type UserName,
} from './commentsClient'
import {
  findPostedByNonce,
  repliesOldestFirst,
  rootsForDiagram,
  toDiagramComment,
  type DiagramThread,
} from './commentThreads'
import { buildCommentAdf, newNonce, plannedRecipients } from './composeComment'
import { getPageRootComments, invalidatePageComments } from './pageCommentsCache'

const props = defineProps<{
  pageId: string
  diagramId: string
  localId?: string
  diagramVersion?: number
  pageUrl: string
  diagramTitle?: string
  lastModifierId?: string
  currentAccountId?: string
  macroType?: MacroTypeValue
  request?: CommentRequest
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'count', count: number): void
}>()

type Target = { kind: 'root' } | { kind: 'reply'; thread: DiagramThread }
const ROOT = '__root__'

const state = ref<'loading' | 'error' | 'ready'>('loading')
const loadFailure = ref<DiagramCommentFailureReason>('unknown')
const threads = ref<DiagramThread[]>([])
const names = ref<Record<string, UserName>>({})
const rootDraft = ref('')
const replyDrafts = reactive<Record<string, string>>({})
const replyOpenFor = ref<string | null>(null)
const posting = ref(false)
const readOnly = ref(false)
const postNotice = ref<{ target: string; message: string } | null>(null)

let postGuard = false
let loadSeq = 0
let dismissed = false

const req = (): CommentRequest => props.request ?? (requestConfluenceJson as CommentRequest)

const base = (): Pick<AnalyticsProperties, 'feature_area' | 'surface' | 'macro_type'> => ({
  feature_area: 'diagram_comments',
  surface: 'fullscreen',
  macro_type: props.macroType ?? 'none',
})

const LOAD_MESSAGES: Record<DiagramCommentFailureReason, string> = {
  unauthenticated: 'Sign in to Confluence to read comments.',
  permission_denied: 'You do not have permission to read comments on this page.',
  rate_limited: 'Confluence is busy. Try again in a moment.',
  network: 'Could not reach Confluence. Check your connection and try again.',
  unavailable: 'Comments are unavailable right now. Try again later.',
  unknown: 'Something went wrong while loading comments.',
}
const POST_MESSAGES: Record<DiagramCommentFailureReason, string> = {
  unauthenticated: 'Sign in to Confluence to post a comment.',
  permission_denied: '',
  rate_limited: 'Confluence is busy. Your draft is kept; try again in a moment.',
  network: 'The comment was not posted. Your draft is kept; try again.',
  unavailable: 'Comments are unavailable right now. Your draft is kept; try again later.',
  unknown: 'The comment was not posted. Your draft is kept; try again.',
}
const UNCERTAIN_MESSAGE = 'We could not confirm the comment was saved. Check the list before posting again.'

const loadErrorMessage = computed(() => LOAD_MESSAGES[loadFailure.value])

const reasonOf = (e: unknown): DiagramCommentFailureReason => (e instanceof DiagramCommentError ? e.reason : 'unknown')

function nameOf(id: string | undefined): string {
  return (id && names.value[id]?.displayName) || 'Someone'
}
function initials(id: string | undefined): string {
  const parts = nameOf(id).split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 1)
  return letters.toUpperCase()
}
function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// ---- who will be asked to be notified -------------------------------------

const rootRecipients = computed(() =>
  plannedRecipients({ mentionIds: [], lastModifierId: props.lastModifierId, currentAccountId: props.currentAccountId }),
)
function replyRecipients(thread: DiagramThread): string[] {
  return plannedRecipients({
    mentionIds: replyMentionIds(thread),
    lastModifierId: undefined,
    currentAccountId: props.currentAccountId,
  })
}
function replyMentionIds(thread: DiagramThread): string[] {
  const author = thread.root.authorId
  return author && author !== props.currentAccountId ? [author] : []
}
function notifyLine(ids: string[]): string {
  if (!ids.length) return 'No one will be notified'
  const labels = ids.map(id => nameOf(id) + (id === props.lastModifierId ? ' (last editor)' : ''))
  return `Will notify: ${labels.join(', ')}`
}

// ---- loading ---------------------------------------------------------------

async function load(opts: { silent?: boolean } = {}): Promise<void> {
  const seq = ++loadSeq
  if (!opts.silent) state.value = 'loading'
  try {
    const request = req()
    const raws = await getPageRootComments(request, props.pageId)
    const roots = rootsForDiagram(raws, props.diagramId)
    const replyRaws = await Promise.all(roots.map(root => fetchReplies(request, root.id)))
    const loaded: DiagramThread[] = roots.map((root, i) => ({ root, replies: repliesOldestFirst(replyRaws[i]) }))
    const ids = [
      ...loaded.flatMap(t => [t.root.authorId, ...t.replies.map(r => r.authorId)]),
      props.lastModifierId,
    ].filter((id): id is string => !!id)
    const fetchedNames = await fetchUserNames(request, ids)
    if (seq !== loadSeq) return
    threads.value = loaded
    names.value = fetchedNames
    state.value = 'ready'
    emit('count', loaded.length)
    trackAnalyticsEvent('diagram_comment_load_completed', {
      ...base(),
      comment_load_outcome: 'succeeded',
      comment_count: loaded.length,
    })
  } catch (e) {
    if (seq !== loadSeq) return
    const reason = reasonOf(e)
    if (opts.silent && state.value === 'ready') {
      // The post itself worked; keep the list we have rather than replace it with an error.
      return
    }
    loadFailure.value = reason
    state.value = 'error'
    trackAnalyticsEvent('diagram_comment_load_completed', {
      ...base(),
      comment_load_outcome: 'failed',
      comment_failure_reason: reason,
    })
  }
}

// ---- posting ---------------------------------------------------------------

function openReply(id: string) {
  replyOpenFor.value = id
  if (replyDrafts[id] === undefined) replyDrafts[id] = ''
}

function onEnter(event: KeyboardEvent, target: Target) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    void submit(target)
  }
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/** After an uncertain save: read back and look for the comment. */
async function wasSaved(target: Target, text: string, nonce: string | undefined): Promise<boolean> {
  invalidatePageComments(props.pageId)
  try {
    const request = req()
    if (target.kind === 'root') {
      const raws = await getPageRootComments(request, props.pageId)
      return !!nonce && !!findPostedByNonce(raws, nonce)
    }
    const raws = await fetchReplies(request, target.thread.root.id)
    const wanted = squash(text)
    return raws.some(raw => {
      const c = toDiagramComment(raw)
      return !!c && !!props.currentAccountId && c.authorId === props.currentAccountId && squash(c.text).endsWith(wanted)
    })
  } catch {
    return false
  }
}

async function submit(target: Target): Promise<void> {
  if (postGuard) return
  const key = target.kind === 'root' ? ROOT : target.thread.root.id
  const text = (target.kind === 'root' ? rootDraft.value : (replyDrafts[key] ?? '')).trim()
  if (!text) return
  postGuard = true
  posting.value = true
  postNotice.value = null

  const action = target.kind
  const mentionIds =
    target.kind === 'root'
      ? props.lastModifierId && props.lastModifierId !== props.currentAccountId
        ? [props.lastModifierId]
        : []
      : replyMentionIds(target.thread)
  const mentions = mentionIds.map(accountId => ({ accountId, name: nameOf(accountId) }))
  trackAnalyticsEvent('diagram_comment_submit_requested', {
    ...base(),
    comment_thread_action: action,
    comment_mention_count: mentions.length,
  })

  let nonce: string | undefined
  let adf
  if (target.kind === 'root') {
    nonce = newNonce()
    const href = buildCommentLink(props.pageUrl, {
      diagramId: props.diagramId,
      localId: props.localId,
      diagramVersion: props.diagramVersion,
      nonce,
    })
    const label = `${props.diagramTitle || 'Diagram'}${props.diagramVersion !== undefined ? ' · v' + props.diagramVersion : ''}`
    adf = buildCommentAdf({ text, mentions, link: { href, label } })
  } else {
    adf = buildCommentAdf({ text, mentions })
  }

  let saved = false
  try {
    try {
      await postFooterComment(
        req(),
        target.kind === 'root' ? { pageId: props.pageId, adf } : { parentCommentId: target.thread.root.id, adf },
      )
      saved = true
    } catch (e) {
      if (e instanceof DiagramCommentError && e.uncertain) {
        if (await wasSaved(target, text, nonce)) {
          saved = true
        } else {
          postNotice.value = { target: key, message: UNCERTAIN_MESSAGE }
        }
      } else {
        const reason = reasonOf(e)
        trackAnalyticsEvent('diagram_comment_submit_failed', {
          ...base(),
          comment_thread_action: action,
          comment_failure_reason: reason,
        })
        if (reason === 'permission_denied') readOnly.value = true
        else postNotice.value = { target: key, message: POST_MESSAGES[reason] }
      }
    }

    if (saved) {
      if (target.kind === 'root') rootDraft.value = ''
      else {
        replyDrafts[key] = ''
        replyOpenFor.value = null
      }
      trackAnalyticsEvent('diagram_comment_submit_succeeded', {
        ...base(),
        comment_thread_action: action,
        comment_mention_count: mentions.length,
        comment_planned_recipient_count: plannedRecipients({
          mentionIds,
          lastModifierId: target.kind === 'root' ? props.lastModifierId : undefined,
          currentAccountId: props.currentAccountId,
        }).length,
      })
      if (target.kind === 'root') invalidatePageComments(props.pageId)
      await load({ silent: true })
    }
  } finally {
    posting.value = false
    postGuard = false
  }
}

// ---- lifecycle -------------------------------------------------------------

const hasDraft = () => !!rootDraft.value.trim() || Object.values(replyDrafts).some(d => !!d.trim())

function fireDismissed() {
  if (dismissed) return
  dismissed = true
  trackAnalyticsEvent('diagram_comment_dismissed', { ...base(), comment_had_draft: hasDraft() })
}

function onClose() {
  fireDismissed()
  emit('close')
}

onMounted(() => {
  trackAnalyticsEvent('diagram_comment_panel_opened', base())
  void load()
})
onBeforeUnmount(fireDismissed)
</script>

<style scoped>
.dc-panel {
  display: flex;
  flex-direction: column;
  width: 380px;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  background: #fff;
  border-left: 1px solid #e5e7eb;
  color: #172b4d;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 20px;
}
.dc-header {
  flex: 0 0 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid #e5e7eb;
}
.dc-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.dc-close {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #6b778c;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.dc-close:hover {
  background: #f1f2f4;
}
.dc-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
}
.dc-status {
  margin: 0;
  color: #6b778c;
}
.dc-status--error p {
  margin: 0 0 12px;
  color: #ae2a19;
}
.dc-empty {
  padding: 32px 8px;
  text-align: center;
}
.dc-empty-title {
  margin: 0 0 4px;
  font-weight: 600;
}
.dc-empty-hint {
  margin: 0;
  color: #6b778c;
}
.dc-threads,
.dc-replies {
  list-style: none;
  margin: 0;
  padding: 0;
}
.dc-thread {
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid #e5e7eb;
}
.dc-thread:last-child {
  border-bottom: 0;
  margin-bottom: 0;
}
.dc-replies {
  margin: 12px 0 0 20px;
  padding-left: 12px;
  border-left: 2px solid #e5e7eb;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dc-comment {
  display: flex;
  gap: 10px;
}
.dc-comment-main {
  min-width: 0;
  flex: 1;
}
.dc-avatar {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #0c66e4;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 32px;
  text-align: center;
}
.dc-avatar--small {
  flex-basis: 24px;
  width: 24px;
  height: 24px;
  font-size: 10px;
  line-height: 24px;
}
.dc-meta {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.dc-author {
  font-weight: 600;
}
.dc-time,
.dc-version {
  color: #6b778c;
  font-size: 12px;
}
.dc-version {
  margin: 0;
}
.dc-text {
  margin: 4px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dc-link-button {
  margin: 8px 0 0 42px;
  padding: 0;
  border: 0;
  background: none;
  color: #0c66e4;
  font: inherit;
  cursor: pointer;
}
.dc-link-button:hover {
  text-decoration: underline;
}
.dc-footer {
  flex: 0 0 auto;
  padding: 12px 16px 16px;
  border-top: 1px solid #e5e7eb;
}
.dc-compose--reply {
  margin: 12px 0 0 42px;
}
.dc-textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid #c1c7d0;
  border-radius: 4px;
  font: inherit;
  resize: vertical;
}
.dc-textarea:focus {
  outline: 2px solid #0c66e4;
  outline-offset: -1px;
}
.dc-notify {
  margin: 8px 0 0;
  color: #6b778c;
  font-size: 12px;
}
.dc-error {
  margin: 8px 0 0;
  color: #ae2a19;
  font-size: 12px;
}
.dc-readonly {
  margin: 0;
  color: #6b778c;
}
.dc-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
.dc-button {
  padding: 6px 14px;
  border: 0;
  border-radius: 4px;
  background: #0c66e4;
  color: #fff;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
}
.dc-button:disabled {
  background: #e5e7eb;
  color: #8993a4;
  cursor: not-allowed;
}
.dc-button--secondary {
  background: #f1f2f4;
  color: #172b4d;
}
</style>
