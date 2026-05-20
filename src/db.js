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

// Generate or retrieve a local sync code
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

// Load progress from cloud
export async function loadProgress(syncCode) {
  try {
    await init()
    const res = await db.collection(COLLECTION).doc(syncCode).get()
    if (res.data && res.data.length > 0) {
      return res.data[0].progress || {}
    }
    return {}
  } catch (e) {
    console.warn('Cloud load failed, using local', e)
    return null // signal to use local
  }
}

// Save progress to cloud (debounced)
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
      updatedAt: db.serverDate()
    })
  } catch (e) {
    console.warn('Cloud save failed', e)
  }
}
