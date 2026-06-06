import cloudbase from '@cloudbase/js-sdk'

const ENV_ID = 'quiz-d5g0aiqs9084ec726'
const COLLECTION = 'quiz_progress'

let app = null
let db = null
let initialized = false

async function init() {
  if (initialized) return
  app = cloudbase.init({ env: ENV_ID })
  const auth = app.auth({ persistence: 'local' })
  const loginState = await auth.getLoginState()
  if (!loginState) {
    await auth.anonymousAuthProvider().signIn()
  }
  db = app.database()
  initialized = true
}

export function getLocalSyncCode() {
  let code = localStorage.getItem('quiz_sync_code')
  if (!code) {
    code = Math.random().toString(36).slice(2, 8).toUpperCase()
    localStorage.setItem('quiz_sync_code', code)
  }
  return code
}

export function setSyncCode(code) {
  localStorage.setItem('quiz_sync_code', code.trim().toUpperCase())
}

export async function loadProgress(syncCode) {
  try {
    await init()
    const res = await db.collection(COLLECTION).doc(syncCode).get()
    if (res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
      return res.data.progress || {}
    }
    if (Array.isArray(res.data) && res.data.length > 0) {
      return res.data[0].progress || {}
    }
    return {}
  } catch (e) {
    console.warn('Cloud load failed:', e)
    return null
  }
}

let saveTimer = null
export function saveProgressDebounced(syncCode, progress) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveProgress(syncCode, progress), 2000)
}

export async function saveProgress(syncCode, progress) {
  try {
    await init()
    await db.collection(COLLECTION).doc(syncCode).set({
      progress,
      updatedAt: new Date().toISOString()
    })
    console.log('Cloud save OK:', syncCode)
  } catch (e) {
    try {
      await db.collection(COLLECTION).add({
        _id: syncCode,
        progress,
        updatedAt: new Date().toISOString()
      })
      console.log('Cloud add OK:', syncCode)
    } catch (e2) {
      console.warn('Cloud save failed:', e2)
    }
  }
}
