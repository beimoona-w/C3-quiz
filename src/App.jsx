import { useState, useEffect, useCallback, useRef } from 'react'
import { getLocalSyncCode, setSyncCode, loadProgress, saveProgressDebounced, saveProgress } from './db.js'

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPE_LABEL = { single: '单选', multi: '多选', judge: '判断' }
const TYPE_COLOR = { single: '#3B82F6', multi: '#8B5CF6', judge: '#10B981' }

const today = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.max(1, Math.ceil((new Date(b) - new Date(a)) / 86400000))

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [questions, setQuestions] = useState(null)
  const [examDate, setExamDate] = useState(() => localStorage.getItem('examDate') || '')
  const [progress, setProgress] = useState({})
  const [syncCode, setSyncCodeState] = useState(() => getLocalSyncCode())
  const [view, setView] = useState('loading') // loading | setup | dash | quiz | result | plan | sync
  const [quizQueue, setQuizQueue] = useState([])
  const [quizIdx, setQuizIdx] = useState(0)
  const [sessionStats, setSessionStats] = useState({ correct: 0, wrong: 0 })
  const [selectedOpts, setSelectedOpts] = useState([])
  const [submitted, setSubmitted] = useState(false)
  const [filterType, setFilterType] = useState('all')
  const [syncStatus, setSyncStatus] = useState('idle') // idle | syncing | ok | err
  const [loadingMsg, setLoadingMsg] = useState('加载题库中…')

  // ── Load questions + progress
  useEffect(() => {
    async function bootstrap() {
      // 1. Load questions
      setLoadingMsg('加载题库中…')
      const res = await fetch('/questions.json')
      const qs = await res.json()
      setQuestions(qs)

      // 2. Load progress from cloud
      setLoadingMsg('同步进度中…')
      const code = getLocalSyncCode()
      const cloudProg = await loadProgress(code)
      const localProg = JSON.parse(localStorage.getItem('quiz_progress') || '{}')

      // Merge: cloud wins on conflicts (newer updatedAt)
      const merged = { ...localProg, ...(cloudProg || {}) }
      setProgress(merged)
      localStorage.setItem('quiz_progress', JSON.stringify(merged))

      const date = localStorage.getItem('examDate')
      setView(date ? 'dash' : 'setup')
    }
    bootstrap().catch(e => {
      console.error(e)
      // Fallback to local
      const localProg = JSON.parse(localStorage.getItem('quiz_progress') || '{}')
      setProgress(localProg)
      const date = localStorage.getItem('examDate')
      setView(date ? 'dash' : 'setup')
    })
  }, [])

  // ── Persist progress
  const updateProgress = useCallback((newProg) => {
    setProgress(newProg)
    localStorage.setItem('quiz_progress', JSON.stringify(newProg))
    saveProgressDebounced(syncCode, newProg)
  }, [syncCode])

  const saveExamDate = (d) => {
    setExamDate(d)
    localStorage.setItem('examDate', d)
    setView('dash')
  }

  // ── Derived
  const doneIds = new Set(Object.keys(progress).map(Number))
  const wrongIds = new Set(
    Object.entries(progress).filter(([, v]) => !v.correct).map(([k]) => Number(k))
  )

  // ── Start quiz
  const startQuiz = useCallback((mode) => {
    if (!questions) return
    let pool
    if (mode === 'wrong') {
      pool = questions.filter(q => wrongIds.has(q.seq))
    } else {
      pool = questions.filter(q => !doneIds.has(q.seq))
      if (filterType !== 'all') pool = pool.filter(q => q.type === filterType)
      if (mode === 'daily') {
        const plan = buildPlan(questions.length, doneIds.size, examDate)
        pool = pool.slice(0, plan.perDay)
      }
    }
    if (pool.length === 0) { alert(mode === 'wrong' ? '错题集为空！' : '当前分类已全部完成！'); return }
    setQuizQueue(pool)
    setQuizIdx(0)
    setSessionStats({ correct: 0, wrong: 0 })
    setSelectedOpts([])
    setSubmitted(false)
    setView('quiz')
  }, [questions, progress, filterType, examDate])

  // ── Answer logic
  const handleSelect = useCallback((key) => {
    if (submitted) return
    const q = quizQueue[quizIdx]
    if (q.type === 'multi') {
      setSelectedOpts(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
    } else {
      // Single/judge: auto-submit
      const userAnswer = key
      const correct = userAnswer === q.answer
      const newProg = { ...progress, [q.seq]: { userAnswer, correct } }
      updateProgress(newProg)
      setSessionStats(s => ({ correct: s.correct + (correct ? 1 : 0), wrong: s.wrong + (correct ? 0 : 1) }))
      setSelectedOpts([key])
      setSubmitted(true)
    }
  }, [submitted, quizQueue, quizIdx, progress, updateProgress])

  const submitMulti = useCallback(() => {
    const q = quizQueue[quizIdx]
    const userAnswer = [...selectedOpts].sort().join('')
    const correct = userAnswer === q.answer
    const newProg = { ...progress, [q.seq]: { userAnswer, correct } }
    updateProgress(newProg)
    setSessionStats(s => ({ correct: s.correct + (correct ? 1 : 0), wrong: s.wrong + (correct ? 0 : 1) }))
    setSubmitted(true)
  }, [quizQueue, quizIdx, selectedOpts, progress, updateProgress])

  const nextQuestion = useCallback(() => {
    if (quizIdx + 1 >= quizQueue.length) { setView('result'); return }
    setQuizIdx(i => i + 1)
    setSelectedOpts([])
    setSubmitted(false)
  }, [quizIdx, quizQueue.length])

  const resetAll = () => {
    if (!confirm('确定清空所有答题记录？')) return
    setProgress({})
    localStorage.removeItem('quiz_progress')
    saveProgress(syncCode, {})
  }

  // ── Sync code change
  const applySyncCode = async (code) => {
    setSyncStatus('syncing')
    setSyncCode(code)
    setSyncCodeState(code)
    const cloudProg = await loadProgress(code)
    if (cloudProg) {
      setProgress(cloudProg)
      localStorage.setItem('quiz_progress', JSON.stringify(cloudProg))
      setSyncStatus('ok')
    } else {
      setSyncStatus('err')
    }
  }

  if (view === 'loading') return <Loader msg={loadingMsg} />
  if (view === 'setup') return <Setup onSave={saveExamDate} />
  if (view === 'dash') return (
    <Dashboard
      questions={questions} progress={progress} wrongIds={wrongIds}
      doneIds={doneIds} examDate={examDate} filterType={filterType}
      onFilterChange={setFilterType} onStartQuiz={startQuiz}
      onPlan={() => setView('plan')} onSync={() => setView('sync')}
      syncCode={syncCode} onReset={resetAll}
    />
  )
  if (view === 'quiz') return (
    <QuizScreen
      q={quizQueue[quizIdx]} qIdx={quizIdx} total={quizQueue.length}
      stats={sessionStats} selectedOpts={selectedOpts} submitted={submitted}
      onSelect={handleSelect} onSubmitMulti={submitMulti}
      onNext={nextQuestion} onExit={() => setView('dash')}
      progress={progress}
    />
  )
  if (view === 'result') return (
    <ResultScreen stats={sessionStats} total={quizQueue.length}
      onDash={() => setView('dash')} />
  )
  if (view === 'plan') return (
    <PlanScreen questions={questions} doneIds={doneIds} examDate={examDate}
      onBack={() => setView('dash')} />
  )
  if (view === 'sync') return (
    <SyncScreen syncCode={syncCode} status={syncStatus}
      onApply={applySyncCode} onBack={() => setView('dash')} />
  )
  return null
}

// ─── Build plan ───────────────────────────────────────────────────────────────
function buildPlan(total, done, examDate) {
  const remaining = total - done
  const days = examDate ? daysBetween(today(), examDate) : 30
  const perDay = Math.ceil(remaining / days)
  return { remaining, days, perDay }
}

// ─── Loader ───────────────────────────────────────────────────────────────────
function Loader({ msg }) {
  return (
    <div style={S.center}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
      <div style={{ color: '#94A3B8' }}>{msg}</div>
    </div>
  )
}

// ─── Setup ────────────────────────────────────────────────────────────────────
function Setup({ onSave }) {
  const [date, setDate] = useState('')
  return (
    <div style={S.page}>
      <div style={S.setupWrap}>
        <div style={{ fontSize: 56, textAlign: 'center' }}>📋</div>
        <h1 style={S.setupTitle}>C3 安全考试刷题</h1>
        <p style={S.setupSub}>广东省建筑施工企业综合类专职{'\n'}安全生产管理人员（C3类）</p>
        <div style={S.card}>
          <label style={S.label}>请输入你的考试日期</label>
          <input type="date" value={date} min={today()} onChange={e => setDate(e.target.value)} style={S.input} />
        </div>
        <button style={{ ...S.btnPrimary, opacity: date ? 1 : 0.4, width: '100%' }}
          disabled={!date} onClick={() => onSave(date)}>
          开始备考 →
        </button>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ questions, progress, wrongIds, doneIds, examDate, filterType, onFilterChange, onStartQuiz, onPlan, onSync, syncCode, onReset }) {
  const total = questions?.length || 0
  const done = doneIds.size
  const correct = Object.values(progress).filter(v => v.correct).length
  const pct = total ? Math.round(done / total * 100) : 0
  const plan = buildPlan(total, done, examDate)
  const daysLeft = examDate ? daysBetween(today(), examDate) : '—'

  const typeStats = ['single', 'multi', 'judge'].map(t => {
    const qs = questions?.filter(q => q.type === t) || []
    return { type: t, total: qs.length, done: qs.filter(q => doneIds.has(q.seq)).length }
  })

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div>
          <div style={S.headerTitle}>C3 刷题本</div>
          <div style={S.headerSub}>距考试 {daysLeft} 天 · {examDate}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn icon onClick={onPlan}>📅</Btn>
          <Btn icon onClick={onSync} title="同步码">🔄</Btn>
        </div>
      </div>

      {/* Progress */}
      <div style={{ ...S.card, margin: '12px 16px', display: 'flex', gap: 20, alignItems: 'center' }}>
        <Ring pct={pct} done={done} total={total} />
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Stat label="已完成" value={done} color="#3B82F6" />
          <Stat label="答对" value={correct} color="#10B981" />
          <Stat label="错题" value={wrongIds.size} color="#EF4444" />
          <Stat label="每日目标" value={plan.perDay} color="#F59E0B" />
        </div>
      </div>

      {/* Type bars */}
      <div style={S.section}>
        <div style={S.secTitle}>题型进度</div>
        {typeStats.map(({ type, total: t, done: d }) => (
          <TypeBar key={type} label={TYPE_LABEL[type]} done={d} total={t} color={TYPE_COLOR[type]} />
        ))}
      </div>

      {/* Filter */}
      <div style={S.section}>
        <div style={S.secTitle}>题型筛选</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[['all', '全部'], ['single', '单选'], ['multi', '多选'], ['judge', '判断']].map(([k, v]) => (
            <button key={k} style={{ ...S.chip, ...(filterType === k ? S.chipActive : {}) }}
              onClick={() => onFilterChange(k)}>{v}</button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={S.section}>
        <div style={S.secTitle}>开始答题</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <ActionCard icon="📖" title="今日计划" sub={`${plan.perDay} 题`} color="#3B82F6" onClick={() => onStartQuiz('daily')} />
          <ActionCard icon="❌" title="错题复习" sub={`${wrongIds.size} 题`} color="#EF4444" onClick={() => onStartQuiz('wrong')} disabled={wrongIds.size === 0} />
          <ActionCard icon="🚀" title="全部刷题" sub={`${plan.remaining} 题`} color="#8B5CF6" onClick={() => onStartQuiz('all')} />
        </div>
      </div>

      <div style={{ padding: '0 16px 8px', fontSize: 12, color: '#475569', textAlign: 'center' }}>
        同步码：<strong style={{ color: '#64748B' }}>{syncCode}</strong>
      </div>
      <div style={{ padding: '0 16px 32px' }}>
        <button style={{ ...S.btnGhost, width: '100%' }} onClick={onReset}>清空答题记录</button>
      </div>
    </div>
  )
}

// ─── Quiz Screen ──────────────────────────────────────────────────────────────
function QuizScreen({ q, qIdx, total, stats, selectedOpts, submitted, onSelect, onSubmitMulti, onNext, onExit, progress }) {
  if (!q) return null
  const userAnswer = [...selectedOpts].sort().join('')
  const isCorrect = submitted && userAnswer === q.answer
  const pct = Math.round(qIdx / total * 100)
  const histEntry = progress[q.seq]

  return (
    <div style={S.page}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
        <Btn icon onClick={onExit}>✕</Btn>
        <span style={{ color: '#94A3B8', fontSize: 14 }}>{qIdx + 1} / {total}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Badge color="#10B981">✓{stats.correct}</Badge>
          <Badge color="#EF4444">✗{stats.wrong}</Badge>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: '#1E293B', margin: '10px 0' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#3B82F6', transition: 'width .3s' }} />
      </div>

      {/* Question card */}
      <div style={{ ...S.card, margin: '0 16px 14px', flexShrink: 0 }}>
        <div style={{ marginBottom: 10 }}>
          <span style={{ ...S.typeBadge, background: TYPE_COLOR[q.type] + '22', color: TYPE_COLOR[q.type] }}>
            {TYPE_LABEL[q.type]}题 · 第{q.id}题
          </span>
          {histEntry && (
            <span style={{ marginLeft: 8, fontSize: 12, color: histEntry.correct ? '#10B981' : '#EF4444' }}>
              {histEntry.correct ? '✓ 曾答对' : '✗ 曾答错'}
            </span>
          )}
        </div>
        <div style={S.stem}>{q.stem}</div>
        {q.type === 'multi' && !submitted && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#8B5CF6', background: '#1E1B4B', borderRadius: 6, padding: '4px 10px', display: 'inline-block' }}>
            多选题，全部选完后点"提交"
          </div>
        )}
      </div>

      {/* Options */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto' }}>
        {Object.entries(q.options).map(([key, val]) => {
          const sel = selectedOpts.includes(key)
          const isAns = q.answer.includes(key)
          let extra = {}
          if (submitted) {
            if (isAns) extra = { borderColor: '#10B981', background: '#052E16' }
            else if (sel) extra = { borderColor: '#EF4444', background: '#2D0B0B' }
          } else if (sel) {
            extra = { borderColor: '#3B82F6', background: '#1E3A5F' }
          }
          return (
            <button key={key} onClick={() => onSelect(key)}
              style={{ ...S.optBtn, ...extra }}>
              <span style={{
                width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
                background: submitted ? (isAns ? '#10B981' : sel ? '#EF4444' : '#0F172A') : (sel ? '#3B82F6' : '#0F172A'),
                color: (submitted && isAns) || (!submitted && sel) ? '#fff' : '#94A3B8'
              }}>{key}</span>
              <span style={{ fontSize: 15, color: '#CBD5E1', flex: 1, lineHeight: 1.6, textAlign: 'left' }}>{val}</span>
              {submitted && isAns && <span style={{ color: '#10B981', fontSize: 16 }}>✓</span>}
              {submitted && sel && !isAns && <span style={{ color: '#EF4444', fontSize: 16 }}>✗</span>}
            </button>
          )
        })}
      </div>

      {/* Result banner */}
      {submitted && (
        <div style={{ margin: '12px 16px 0', padding: '12px 16px', borderRadius: 10, background: isCorrect ? '#064E3B' : '#450A0A' }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{isCorrect ? '✅ 回答正确！' : '❌ 回答错误'}</div>
          {!isCorrect && (
            <div style={{ fontSize: 14, marginTop: 4, color: '#FCA5A5' }}>
              正确答案：<strong style={{ color: '#4ADE80' }}>{q.answer}</strong>
            </div>
          )}
        </div>
      )}

      {/* Bottom */}
      <div style={{ padding: 16 }}>
        {q.type === 'multi' && !submitted
          ? <button style={{ ...S.btnPrimary, width: '100%', opacity: selectedOpts.length > 0 ? 1 : 0.4 }}
              disabled={selectedOpts.length === 0} onClick={onSubmitMulti}>提交答案</button>
          : submitted
          ? <button style={{ ...S.btnPrimary, width: '100%' }} onClick={onNext}>下一题 →</button>
          : null}
      </div>
    </div>
  )
}

// ─── Result Screen ────────────────────────────────────────────────────────────
function ResultScreen({ stats, total, onDash }) {
  const rate = Math.round(stats.correct / total * 100)
  return (
    <div style={S.center}>
      <div style={{ fontSize: 60 }}>{rate >= 80 ? '🎉' : rate >= 60 ? '💪' : '📚'}</div>
      <h2 style={{ color: '#F1F5F9', margin: '16px 0 8px' }}>本轮完成！</h2>
      <div style={{ color: '#94A3B8', marginBottom: 24 }}>共 {total} 题 · 正确 {stats.correct} · 错误 {stats.wrong}</div>
      <div style={{ fontSize: 56, fontWeight: 700, color: rate >= 80 ? '#4ADE80' : rate >= 60 ? '#FBBF24' : '#F87171' }}>{rate}%</div>
      <div style={{ color: '#94A3B8', marginBottom: 40 }}>正确率</div>
      <button style={{ ...S.btnPrimary, width: 200 }} onClick={onDash}>返回主页</button>
    </div>
  )
}

// ─── Plan Screen ──────────────────────────────────────────────────────────────
function PlanScreen({ questions, doneIds, examDate, onBack }) {
  const total = questions?.length || 0
  const done = doneIds.size
  const plan = buildPlan(total, done, examDate)
  const daysLeft = examDate ? daysBetween(today(), examDate) : 30

  return (
    <div style={S.page}>
      <div style={S.header}>
        <Btn icon onClick={onBack}>←</Btn>
        <div style={{ ...S.headerTitle, flex: 1, textAlign: 'center' }}>备考计划</div>
        <div style={{ width: 36 }} />
      </div>

      <div style={{ ...S.card, margin: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 20 }}>
          <PlanStat label="剩余天数" value={plan.days} />
          <PlanStat label="未做题目" value={plan.remaining} />
          <PlanStat label="每日目标" value={plan.perDay} color="#FBBF24" />
        </div>
        <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 6 }}>
          总进度：{done} / {total}（{Math.round(done / total * 100)}%）
        </div>
        <Bar pct={Math.round(done / total * 100)} color="#3B82F6" />
      </div>

      <div style={{ padding: '0 16px' }}>
        <div style={S.secTitle}>题型分布</div>
        {['single', 'multi', 'judge'].map(t => {
          const qs = questions?.filter(q => q.type === t) || []
          const d = qs.filter(q => doneIds.has(q.seq)).length
          const pct = qs.length ? Math.round(d / qs.length * 100) : 0
          const perDay = Math.ceil((qs.length - d) / plan.days)
          return (
            <div key={t} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ ...S.typeBadge, background: TYPE_COLOR[t] + '22', color: TYPE_COLOR[t] }}>{TYPE_LABEL[t]}</span>
                <span style={{ color: '#94A3B8', fontSize: 13 }}>{d}/{qs.length} · 每日 ~{perDay} 题</span>
              </div>
              <Bar pct={pct} color={TYPE_COLOR[t]} />
            </div>
          )
        })}
      </div>

      <div style={{ padding: '12px 16px 32px' }}>
        <div style={S.secTitle}>未来 {Math.min(daysLeft, 21)} 天日历</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {Array.from({ length: Math.min(daysLeft, 21) }, (_, i) => {
            const d = new Date(); d.setDate(d.getDate() + i)
            const ds = d.toISOString().slice(0, 10)
            const isToday = ds === today()
            return (
              <div key={ds} style={{ background: isToday ? '#1E3A5F' : '#1E293B', border: isToday ? '1.5px solid #3B82F6' : 'none', borderRadius: 6, padding: '6px 2px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#64748B' }}>{ds.slice(5)}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F1F5F9', marginTop: 2 }}>{plan.perDay}</div>
                <div style={{ fontSize: 10, color: '#475569' }}>题</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Sync Screen ──────────────────────────────────────────────────────────────
function SyncScreen({ syncCode, status, onApply, onBack }) {
  const [input, setInput] = useState(syncCode)
  return (
    <div style={S.page}>
      <div style={S.header}>
        <Btn icon onClick={onBack}>←</Btn>
        <div style={{ ...S.headerTitle, flex: 1, textAlign: 'center' }}>跨设备同步</div>
        <div style={{ width: 36 }} />
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: '#94A3B8', lineHeight: 1.8 }}>
            你的<strong style={{ color: '#F1F5F9' }}>同步码</strong>是一个专属于你的 ID，在另一台设备上输入同样的同步码，即可读取云端进度。<br /><br />
            ⚠️ 请妥善保存同步码，丢失后无法恢复云端进度。
          </div>
        </div>

        <div style={S.secTitle}>当前同步码</div>
        <div style={{ ...S.card, marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 6, color: '#3B82F6', padding: '8px 0' }}>{syncCode}</div>
        </div>

        <div style={S.secTitle}>切换到其他设备的同步码</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input value={input} onChange={e => setInput(e.target.value.toUpperCase())}
            placeholder="输入同步码（6位字母数字）"
            style={{ ...S.input, flex: 1 }} maxLength={10} />
          <button style={{ ...S.btnPrimary, padding: '0 16px', flexShrink: 0 }}
            onClick={() => onApply(input)} disabled={!input || input === syncCode}>
            确认
          </button>
        </div>
        {status === 'syncing' && <div style={{ color: '#94A3B8', fontSize: 13 }}>同步中…</div>}
        {status === 'ok' && <div style={{ color: '#10B981', fontSize: 13 }}>✓ 同步成功，进度已加载</div>}
        {status === 'err' && <div style={{ color: '#F59E0B', fontSize: 13 }}>⚠ 该同步码暂无云端数据，将使用本地进度</div>}
      </div>
    </div>
  )
}

// ─── Shared Components ────────────────────────────────────────────────────────
function Ring({ pct, done, total }) {
  const r = 44, circ = 2 * Math.PI * r
  return (
    <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
      <svg width="110" height="110" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="55" cy="55" r={r} fill="none" stroke="#1E293B" strokeWidth="10" />
        <circle cx="55" cy="55" r={r} fill="none" stroke="#3B82F6" strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={circ - pct / 100 * circ} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#F1F5F9' }}>{pct}%</div>
        <div style={{ fontSize: 11, color: '#64748B' }}>{done}/{total}</div>
      </div>
    </div>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748B' }}>{label}</div>
    </div>
  )
}

function PlanStat({ label, value, color = '#3B82F6' }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748B', marginTop: 4 }}>{label}</div>
    </div>
  )
}

function TypeBar({ label, done, total, color }) {
  const pct = total ? Math.round(done / total * 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: '#94A3B8', fontSize: 13 }}>{label}题</span>
        <span style={{ color: '#64748B', fontSize: 13 }}>{done}/{total} ({pct}%)</span>
      </div>
      <Bar pct={pct} color={color} />
    </div>
  )
}

function Bar({ pct, color }) {
  return (
    <div style={{ height: 6, background: '#0F172A', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .6s ease' }} />
    </div>
  )
}

function ActionCard({ icon, title, sub, color, onClick, disabled }) {
  return (
    <button onClick={disabled ? undefined : onClick}
      style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: '14px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <span style={{ fontSize: 26 }}>{icon}</span>
      <span style={{ fontWeight: 600, color: '#F1F5F9', fontSize: 13 }}>{title}</span>
      <span style={{ fontSize: 11, color }}>{sub}</span>
    </button>
  )
}

function Badge({ children, color }) {
  return <span style={{ background: color + '22', color, borderRadius: 6, padding: '2px 8px', fontSize: 13, fontWeight: 600 }}>{children}</span>
}

function Btn({ icon, children, onClick }) {
  return (
    <button onClick={onClick} style={{ background: 'transparent', color: '#94A3B8', fontSize: icon ? 18 : 14, padding: '4px 8px', borderRadius: 6 }}>
      {children}
    </button>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: '100vh', background: '#0F172A', display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto', overflowY: 'auto' },
  center: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', background: '#0F172A' },
  setupWrap: { padding: '48px 24px 32px', display: 'flex', flexDirection: 'column', gap: 20, flex: 1 },
  setupTitle: { fontSize: 26, fontWeight: 700, textAlign: 'center', color: '#F1F5F9' },
  setupSub: { fontSize: 13, color: '#64748B', textAlign: 'center', whiteSpace: 'pre-line' },
  card: { background: '#1E293B', borderRadius: 14, padding: 16 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 12px', borderBottom: '1px solid #1E293B' },
  headerTitle: { fontSize: 17, fontWeight: 700, color: '#F1F5F9' },
  headerSub: { fontSize: 12, color: '#64748B', marginTop: 2 },
  section: { padding: '10px 16px' },
  secTitle: { fontSize: 12, color: '#64748B', fontWeight: 700, letterSpacing: 1, marginBottom: 10, textTransform: 'uppercase' },
  label: { fontSize: 14, color: '#94A3B8', fontWeight: 500, marginBottom: 8, display: 'block' },
  input: { background: '#0F172A', border: '1.5px solid #334155', borderRadius: 8, color: '#F1F5F9', padding: '11px 14px', fontSize: 15, outline: 'none', width: '100%' },
  btnPrimary: { background: '#3B82F6', color: '#fff', padding: '13px 24px', borderRadius: 10, fontSize: 15, fontWeight: 600 },
  btnGhost: { background: 'transparent', color: '#475569', padding: '10px', borderRadius: 8, fontSize: 13 },
  chip: { padding: '7px 16px', borderRadius: 20, border: '1px solid #334155', background: 'transparent', color: '#94A3B8', fontSize: 13 },
  chipActive: { background: '#3B82F6', borderColor: '#3B82F6', color: '#fff' },
  typeBadge: { display: 'inline-block', fontSize: 12, padding: '3px 10px', borderRadius: 20, fontWeight: 600 },
  stem: { fontSize: 16, lineHeight: 1.8, color: '#E2E8F0', whiteSpace: 'pre-wrap' },
  optBtn: { display: 'flex', alignItems: 'center', gap: 12, background: '#1E293B', border: '1.5px solid #334155', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', width: '100%', transition: 'all .15s' },
}
