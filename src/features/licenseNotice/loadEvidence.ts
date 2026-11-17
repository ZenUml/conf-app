import { callRemote } from '@/utils/requestUtil'

/** Optional notice evidence must never delay the diagram or leave a live timer. */
export async function loadLicenseNoticeEvidence(): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      callRemote('/api/license-notice', 'GET'),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('license_notice_timeout')), 2000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
