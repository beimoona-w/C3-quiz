import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPE_LABEL = { single: '单选', multi: '多选', judge: '判断' }
const TYPE_COLOR = { single: '#3B82F6', multi: '#8B5CF6', judge: '#10B981' }
const EXAM_CONFIG = { single: 50, multi: 10, judge: 18 } // 题型数量
const EXAM_DURATION = 90 * 60 // 90分钟

const today = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.max(1, Math.ceil((new Date(b) - new Date(a)) / 86400000))

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [questions, setQuestions] = useState(null)
  const [examDate, setExamDate] = useState(() => localStorage.getItem('examDate') || '')
  const [progress, setProgress] = useState({})
  const [view, setView] = useState('loading')
  const [quizQueue, setQuizQueue] = useState([])
  const [quizIdx, setQuizIdx] = useState(0)
  const [sessionStats, setSessionStats] = useState({ correct: 0, wrong: 0 })
  const [selectedOpts, setSelectedOpts] = useState([])
  const [submitted, setSubmitted] = useState(false)
  const [filterType, setFilterType] = useState('all')
  const [loadingMsg, setLoadingMsg] = useState('加载题库中…')
  const [diagnostic, setDiagnostic] = useState(null)
  // Exam state
  const [examQueue, setExamQueue] = useState([])
  const [examResult, setExamResult] = useState(null)

  const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug=1')

  useEffect(() => {
    // Capture diagnostic snapshot before bootstrap
    const all = {}
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      all[k] = localStorage.getItem(k)
    }
    const prog = localStorage.getItem('quiz_progress')
    setDiagnostic({ keys: all, quizProgressRaw: prog, capturedAt: new Date().toISOString() })

    async function bootstrap() {
      setLoadingMsg('加载题库中…')
      const res = await fetch('/questions.json')
      const qs = await res.json()
      setQuestions(qs)
      const localProg = JSON.parse(localStorage.getItem('quiz_progress') || '{}')
      setProgress(localProg)
      const date = localStorage.getItem('examDate')
      setView(date ? 'dash' : 'setup')
    }
    bootstrap().catch(() => {
      const localProg = JSON.parse(localStorage.getItem('quiz_progress') || '{}')
      setProgress(localProg)
      const date = localStorage.getItem('examDate')
      setView(date ? 'dash' : 'setup')
    })
  }, [])

  const updateProgress = useCallback((newProg) => {
    setProgress(newProg)
    localStorage.setItem('quiz_progress', JSON.stringify(newProg))
  }, [])

  const saveExamDate = (d) => {
    setExamDate(d)
    localStorage.setItem('examDate', d)
    setView('dash')
  }

  const doneIds = new Set(Object.keys(progress).map(Number))
  const wrongIds = new Set(
    Object.entries(progress).filter(([, v]) => !v.correct).map(([k]) => Number(k))
  )

  // ── Start quiz (刷题模式)
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
    pool = pool.sort(() => Math.random() - 0.5)
    if (pool.length === 0) { alert(mode === 'wrong' ? '错题集为空！' : '当前分类已全部完成！'); return }
    setQuizQueue(pool)
    setQuizIdx(0)
    setSessionStats({ correct: 0, wrong: 0 })
    setSelectedOpts([])
    setSubmitted(false)
    setView('quiz')
  }, [questions, progress, filterType, examDate])

  // ── Start exam (模拟考试)
  const startExam = useCallback(() => {
    if (!questions) return
    const pick = (type, n) => {
      const pool = questions.filter(q => q.type === type).sort(() => Math.random() - 0.5)
      return pool.slice(0, Math.min(n, pool.length))
    }
    const queue = [
      ...pick('single', EXAM_CONFIG.single),
      ...pick('multi', EXAM_CONFIG.multi),
      ...pick('judge', EXAM_CONFIG.judge),
    ]
    setExamQueue(queue)
    setExamResult(null)
    setView('exam')
  }, [questions])

  // ── Exam submit
  const submitExam = useCallback((answers) => {
    let score = 0
    const newProg = { ...progress }
    const breakdown = { single: { correct: 0, total: 0 }, multi: { correct: 0, total: 0 }, judge: { correct: 0, total: 0 } }

    examQueue.forEach(q => {
      const userAnswer = (answers[q.seq] || []).sort().join('')
      const correct = userAnswer === q.answer
      newProg[q.seq] = { userAnswer: userAnswer || '', correct, fromExam: true }
      breakdown[q.type].total++
      if (correct) {
        breakdown[q.type].correct++
        score += q.type === 'multi' ? 2 : 1
      }
    })

    updateProgress(newProg)
    const totalPossible = EXAM_CONFIG.single * 1 + EXAM_CONFIG.multi * 2 + EXAM_CONFIG.judge * 1
    setExamResult({ score, totalPossible, breakdown, answers, queue: examQueue })
    setView('exam-result')
  }, [examQueue, progress, updateProgress])

  // ── Quiz answer logic
  const handleSelect = useCallback((key) => {
    if (submitted) return
    const q = quizQueue[quizIdx]
    if (q.type === 'multi') {
      setSelectedOpts(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
    } else {
      const correct = key === q.answer
      const newProg = { ...progress, [q.seq]: { userAnswer: key, correct } }
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
  }

  const restoreProgress = useCallback((prog, date) => {
    setProgress(prog)
    localStorage.setItem('quiz_progress', JSON.stringify(prog))
    if (date !== undefined) {
      setExamDate(date)
      localStorage.setItem('examDate', date)
    }
  }, [])

  if (isDebug) return <DebugScreen diagnostic={diagnostic} />

  if (view === 'loading') return <Loader msg={loadingMsg} />
  if (view === 'setup') return <Setup onSave={saveExamDate} />
  if (view === 'dash') return (
    <Dashboard
      questions={questions} progress={progress} wrongIds={wrongIds}
      doneIds={doneIds} examDate={examDate} filterType={filterType}
      onFilterChange={setFilterType} onStartQuiz={startQuiz}
      onStartExam={startExam}
      onPlan={() => setView('plan')} onBackup={() => setView('backup')}
      onReset={resetAll}
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
    <ResultScreen stats={sessionStats} total={quizQueue.length} onDash={() => setView('dash')} />
  )
  if (view === 'exam') return (
    <ExamScreen queue={examQueue} onSubmit={submitExam} onExit={() => setView('dash')} />
  )
  if (view === 'exam-result') return (
    <ExamResultScreen result={examResult} onDash={() => setView('dash')} />
  )
  if (view === 'plan') return (
    <PlanScreen questions={questions} doneIds={doneIds} examDate={examDate} onBack={() => setView('dash')} />
  )
  if (view === 'backup') return (
    <BackupScreen progress={progress} examDate={examDate} onRestore={restoreProgress} onBack={() => setView('dash')} />
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
function Dashboard({ questions, progress, wrongIds, doneIds, examDate, filterType, onFilterChange, onStartQuiz, onStartExam, onPlan, onBackup, onReset }) {
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
      <div style={S.header}>
        <div>
          <div style={S.headerTitle}>C3 刷题本</div>
          <div style={S.headerSub}>距考试 {daysLeft} 天 · {examDate}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn icon onClick={onPlan}>📅</Btn>
          <Btn icon onClick={onBackup}>💾</Btn>
        </div>
      </div>

      <div style={{ ...S.card, margin: '12px 16px', display: 'flex', gap: 20, alignItems: 'center' }}>
        <Ring pct={pct} done={done} total={total} />
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Stat label="已完成" value={done} color="#3B82F6" />
          <Stat label="答对" value={correct} color="#10B981" />
          <Stat label="错题" value={wrongIds.size} color="#EF4444" />
          <Stat label="每日目标" value={plan.perDay} color="#F59E0B" />
        </div>
      </div>

      <div style={S.section}>
        <div style={S.secTitle}>题型进度</div>
        {typeStats.map(({ type, total: t, done: d }) => (
          <TypeBar key={type} label={TYPE_LABEL[type]} done={d} total={t} color={TYPE_COLOR[type]} />
        ))}
      </div>

      <div style={S.section}>
        <div style={S.secTitle}>题型筛选</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[['all', '全部'], ['single', '单选'], ['multi', '多选'], ['judge', '判断']].map(([k, v]) => (
            <button key={k} style={{ ...S.chip, ...(filterType === k ? S.chipActive : {}) }}
              onClick={() => onFilterChange(k)}>{v}</button>
          ))}
        </div>
      </div>

      <div style={S.section}>
        <div style={S.secTitle}>刷题模式</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <ActionCard icon="📖" title="今日计划" sub={`${plan.perDay} 题`} color="#3B82F6" onClick={() => onStartQuiz('daily')} />
          <ActionCard icon="❌" title="错题复习" sub={`${wrongIds.size} 题`} color="#EF4444" onClick={() => onStartQuiz('wrong')} disabled={wrongIds.size === 0} />
          <ActionCard icon="🚀" title="全部刷题" sub={`${plan.remaining} 题`} color="#8B5CF6" onClick={() => onStartQuiz('all')} />
        </div>
      </div>

      {/* 模拟考试入口 */}
      <div style={S.section}>
        <div style={S.secTitle}>模拟考试</div>
        <button onClick={onStartExam} style={S.examEntryBtn}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 32 }}>🎯</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#F1F5F9' }}>开始模拟考试</div>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>单选50 · 多选10 · 判断18 · 限时90分钟</div>
            </div>
          </div>
          <div style={{ fontSize: 18, color: '#94A3B8' }}>→</div>
        </button>
      </div>

      <div style={{ padding: '0 16px 32px' }}>
        <button style={{ ...S.btnGhost, width: '100%' }} onClick={onReset}>清空答题记录</button>
      </div>
    </div>
  )
}

// ─── Exam Screen ──────────────────────────────────────────────────────────────
function ExamScreen({ queue, onSubmit, onExit }) {
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState({}) // {seq: [keys]}
  const [timeLeft, setTimeLeft] = useState(EXAM_DURATION)
  const [showPalette, setShowPalette] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); handleSubmit(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [])

  const handleSubmit = useCallback(() => {
    clearInterval(timerRef.current)
    onSubmit(answers)
  }, [answers, onSubmit])

  const q = queue[idx]
  const sel = answers[q?.seq] || []
  const mins = String(Math.floor(timeLeft / 60)).padStart(2, '0')
  const secs = String(timeLeft % 60).padStart(2, '0')
  const isLow = timeLeft < 300
  const answeredCount = Object.keys(answers).length
  const unansweredCount = queue.length - answeredCount

  const toggleOpt = (key) => {
    if (!q) return
    setAnswers(prev => {
      const cur = prev[q.seq] || []
      if (q.type === 'multi') {
        const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]
        return { ...prev, [q.seq]: next }
      } else {
        return { ...prev, [q.seq]: [key] }
      }
    })
    // Auto advance single/judge after short delay
    if (q.type !== 'multi') {
      setTimeout(() => {
        if (idx < queue.length - 1) setIdx(i => i + 1)
      }, 300)
    }
  }

  // Section boundaries
  const singleEnd = EXAM_CONFIG.single
  const multiEnd = singleEnd + EXAM_CONFIG.multi
  const getSectionLabel = (i) => {
    if (i < singleEnd) return '单选'
    if (i < multiEnd) return '多选'
    return '判断'
  }

  if (!q) return null

  return (
    <div style={S.page}>
      {/* Timer bar */}
      <div style={{ ...S.examTimerBar, background: isLow ? '#7F1D1D' : '#1E293B' }}>
        <button style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}
          onClick={() => { if (confirm('确定退出模拟考试？进度将丢失。')) onExit() }}>✕</button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ fontSize: 11, color: '#64748B', marginRight: 8 }}>模拟考试</span>
          <span style={{ ...S.examTimer, color: isLow ? '#FCA5A5' : '#F1F5F9' }}>
            {isLow && '⏰ '}{mins}:{secs}
          </span>
        </div>
        <button style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: 13, cursor: 'pointer', padding: '0 4px' }}
          onClick={() => setShowPalette(true)}>
          {answeredCount}/{queue.length}
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: '#1E293B' }}>
        <div style={{ height: '100%', width: `${(idx + 1) / queue.length * 100}%`, background: isLow ? '#EF4444' : '#3B82F6', transition: 'width .2s' }} />
      </div>

      {/* Question */}
      <div style={{ ...S.card, margin: '12px 16px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ ...S.typeBadge, background: TYPE_COLOR[q.type] + '22', color: TYPE_COLOR[q.type] }}>
            {TYPE_LABEL[q.type]}题
          </span>
          <span style={{ fontSize: 12, color: '#64748B' }}>第 {idx + 1} 题 / 共 {queue.length} 题</span>
        </div>
        <div style={S.stem}>{q.stem}</div>
        {q.type === 'multi' && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#8B5CF6', background: '#1E1B4B', borderRadius: 6, padding: '4px 10px', display: 'inline-block' }}>
            多选题，可选多项
          </div>
        )}
      </div>

      {/* Options */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto' }}>
        {Object.entries(q.options).map(([key, val]) => {
          const isSelected = sel.includes(key)
          return (
            <button key={key} onClick={() => toggleOpt(key)}
              style={{ ...S.optBtn, ...(isSelected ? { borderColor: '#3B82F6', background: '#1E3A5F' } : {}) }}>
              <span style={{
                width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
                background: isSelected ? '#3B82F6' : '#0F172A',
                color: isSelected ? '#fff' : '#94A3B8'
              }}>{key}</span>
              <span style={{ fontSize: 15, color: '#CBD5E1', flex: 1, lineHeight: 1.6, textAlign: 'left' }}>{val}</span>
            </button>
          )
        })}
      </div>

      {/* Navigation */}
      <div style={{ padding: '12px 16px 16px', display: 'flex', gap: 10 }}>
        <button style={{ ...S.btnGhost, flex: 1, border: '1px solid #334155', borderRadius: 10, padding: 12, opacity: idx === 0 ? 0.3 : 1 }}
          disabled={idx === 0} onClick={() => setIdx(i => i - 1)}>← 上一题</button>
        {idx < queue.length - 1
          ? <button style={{ ...S.btnPrimary, flex: 2, borderRadius: 10 }} onClick={() => setIdx(i => i + 1)}>下一题 →</button>
          : <button style={{ ...S.btnPrimary, flex: 2, borderRadius: 10, background: '#10B981' }}
              onClick={() => setConfirmSubmit(true)}>交卷 ✓</button>
        }
      </div>

      {/* Submit confirm */}
      {confirmSubmit && (
        <div style={S.modal}>
          <div style={S.modalCard}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>📝</div>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>确认交卷？</div>
            <div style={{ fontSize: 14, color: '#94A3B8', marginBottom: 20, lineHeight: 1.6 }}>
              已答 <strong style={{ color: '#F1F5F9' }}>{answeredCount}</strong> 题，
              未答 <strong style={{ color: unansweredCount > 0 ? '#EF4444' : '#10B981' }}>{unansweredCount}</strong> 题
              {unansweredCount > 0 && <div style={{ color: '#F59E0B', marginTop: 4, fontSize: 13 }}>⚠ 还有未作答题目</div>}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button style={{ ...S.btnGhost, flex: 1, border: '1px solid #334155', borderRadius: 10, padding: 12 }}
                onClick={() => setConfirmSubmit(false)}>继续答题</button>
              <button style={{ ...S.btnPrimary, flex: 1, borderRadius: 10, background: '#10B981' }}
                onClick={handleSubmit}>确认交卷</button>
            </div>
          </div>
        </div>
      )}

      {/* Question palette */}
      {showPalette && (
        <div style={S.modal} onClick={() => setShowPalette(false)}>
          <div style={{ ...S.modalCard, maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700 }}>答题卡</div>
              <button style={{ background: 'transparent', border: 'none', color: '#94A3B8', fontSize: 18, cursor: 'pointer' }} onClick={() => setShowPalette(false)}>✕</button>
            </div>
            {['单选题 (1-50)', '多选题 (51-60)', '判断题 (61-78)'].map((label, si) => {
              const start = si === 0 ? 0 : si === 1 ? EXAM_CONFIG.single : EXAM_CONFIG.single + EXAM_CONFIG.multi
              const end = si === 0 ? EXAM_CONFIG.single : si === 1 ? EXAM_CONFIG.single + EXAM_CONFIG.multi : queue.length
              return (
                <div key={si} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>{label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {queue.slice(start, end).map((qq, i) => {
                      const globalIdx = start + i
                      const isAns = !!(answers[qq.seq]?.length)
                      const isCur = globalIdx === idx
                      return (
                        <button key={qq.seq} onClick={() => { setIdx(globalIdx); setShowPalette(false) }}
                          style={{
                            width: 36, height: 36, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                            border: isCur ? '2px solid #3B82F6' : '1px solid #334155',
                            background: isCur ? '#1E3A5F' : isAns ? '#10B981' : '#1E293B',
                            color: isAns || isCur ? '#fff' : '#64748B'
                          }}>
                          {globalIdx + 1}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#64748B', marginTop: 8 }}>
              <span>🟢 已作答</span>
              <span>⬜ 未作答</span>
              <span>🔵 当前</span>
            </div>
            <button style={{ ...S.btnPrimary, width: '100%', marginTop: 16, background: '#10B981', borderRadius: 10 }}
              onClick={() => { setShowPalette(false); setConfirmSubmit(true) }}>交卷</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Exam Result Screen ───────────────────────────────────────────────────────
function ExamResultScreen({ result, onDash }) {
  const { score, totalPossible, breakdown, answers, queue } = result
  const passed = score >= 60
  const rate = Math.round(score / 100 * 100)
  const [showWrong, setShowWrong] = useState(false)
  const wrongQs = queue.filter(q => {
    const ua = (answers[q.seq] || []).sort().join('')
    return ua !== q.answer
  })

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={{ ...S.headerTitle }}>模拟考试结果</div>
      </div>

      {/* Score card */}
      <div style={{ margin: 16, background: passed ? '#052E16' : '#450A0A', borderRadius: 16, padding: 28, textAlign: 'center', border: `1px solid ${passed ? '#10B981' : '#EF4444'}` }}>
        <div style={{ fontSize: 13, color: passed ? '#4ADE80' : '#FCA5A5', letterSpacing: 2, marginBottom: 8 }}>
          {passed ? '✅ 恭喜通过！' : '❌ 未通过，继续加油'}
        </div>
        <div style={{ fontSize: 72, fontWeight: 900, color: passed ? '#4ADE80' : '#F87171', lineHeight: 1 }}>
          {score}
        </div>
        <div style={{ fontSize: 14, color: '#64748B', marginTop: 4 }}>满分 100 分 · 及格线 60 分</div>
      </div>

      {/* Breakdown */}
      <div style={{ ...S.card, margin: '0 16px 16px' }}>
        <div style={S.secTitle}>各题型得分</div>
        {[
          { type: 'single', label: '单选题', points: 1, total: EXAM_CONFIG.single },
          { type: 'multi', label: '多选题', points: 2, total: EXAM_CONFIG.multi },
          { type: 'judge', label: '判断题', points: 1, total: EXAM_CONFIG.judge },
        ].map(({ type, label, points, total }) => {
          const { correct, total: t } = breakdown[type]
          const got = correct * points
          const max = total * points
          const pct = Math.round(correct / t * 100)
          return (
            <div key={type} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 14 }}>
                <span style={{ ...S.typeBadge, background: TYPE_COLOR[type] + '22', color: TYPE_COLOR[type] }}>{label}</span>
                <span style={{ color: '#F1F5F9' }}>{got} / {max} 分（{correct}/{t} 题，{pct}%）</span>
              </div>
              <Bar pct={pct} color={TYPE_COLOR[type]} />
            </div>
          )
        })}
      </div>

      {/* Wrong questions review */}
      {wrongQs.length > 0 && (
        <div style={{ margin: '0 16px 16px' }}>
          <button style={{ ...S.examEntryBtn, justifyContent: 'space-between' }}
            onClick={() => setShowWrong(!showWrong)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 24 }}>❌</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 700, color: '#F1F5F9' }}>查看错题（{wrongQs.length} 道）</div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>已自动加入错题库</div>
              </div>
            </div>
            <span style={{ color: '#94A3B8', transition: 'transform .2s', transform: showWrong ? 'rotate(90deg)' : '' }}>▶</span>
          </button>
          {showWrong && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {wrongQs.map((q, i) => {
                const ua = (answers[q.seq] || []).sort().join('') || '（未作答）'
                return (
                  <div key={q.seq} style={{ ...S.card, borderLeft: `3px solid ${TYPE_COLOR[q.type]}` }}>
                    <div style={{ fontSize: 12, color: '#64748B', marginBottom: 6 }}>
                      <span style={{ ...S.typeBadge, background: TYPE_COLOR[q.type] + '22', color: TYPE_COLOR[q.type] }}>{TYPE_LABEL[q.type]}</span>
                      <span style={{ marginLeft: 8 }}>第{q.id}题</span>
                    </div>
                    <div style={{ fontSize: 14, color: '#E2E8F0', lineHeight: 1.6, marginBottom: 10 }}>{q.stem}</div>
                    {Object.entries(q.options).map(([k, v]) => (
                      <div key={k} style={{ fontSize: 13, padding: '4px 8px', marginBottom: 3, borderRadius: 5,
                        background: q.answer.includes(k) ? '#052E16' : ua.includes(k) ? '#2D0B0B' : 'transparent',
                        color: q.answer.includes(k) ? '#4ADE80' : ua.includes(k) ? '#FCA5A5' : '#94A3B8' }}>
                        {k}. {v} {q.answer.includes(k) ? '✓' : ua.includes(k) ? '✗' : ''}
                      </div>
                    ))}
                    <div style={{ fontSize: 12, marginTop: 8, color: '#64748B' }}>
                      你的答案：<span style={{ color: '#FCA5A5' }}>{ua}</span>
                      　正确答案：<span style={{ color: '#4ADE80' }}>{q.answer}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: '0 16px 32px' }}>
        <button style={{ ...S.btnPrimary, width: '100%', borderRadius: 10 }} onClick={onDash}>返回主页</button>
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
        <Btn icon onClick={onExit}>✕</Btn>
        <span style={{ color: '#94A3B8', fontSize: 14 }}>{qIdx + 1} / {total}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Badge color="#10B981">✓{stats.correct}</Badge>
          <Badge color="#EF4444">✗{stats.wrong}</Badge>
        </div>
      </div>
      <div style={{ height: 3, background: '#1E293B', margin: '10px 0' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#3B82F6', transition: 'width .3s' }} />
      </div>
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
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto' }}>
        {Object.entries(q.options).map(([key, val]) => {
          const sel = selectedOpts.includes(key)
          const isAns = q.answer.includes(key)
          let extra = {}
          if (submitted) {
            if (isAns) extra = { borderColor: '#10B981', background: '#052E16' }
            else if (sel) extra = { borderColor: '#EF4444', background: '#2D0B0B' }
          } else if (sel) extra = { borderColor: '#3B82F6', background: '#1E3A5F' }
          return (
            <button key={key} onClick={() => onSelect(key)} style={{ ...S.optBtn, ...extra }}>
              <span style={{
                width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700,
                background: submitted ? (isAns ? '#10B981' : sel ? '#EF4444' : '#0F172A') : (sel ? '#3B82F6' : '#0F172A'),
                color: (submitted && isAns) || (!submitted && sel) ? '#fff' : '#94A3B8'
              }}>{key}</span>
              <span style={{ fontSize: 15, color: '#CBD5E1', flex: 1, lineHeight: 1.6, textAlign: 'left' }}>{val}</span>
              {submitted && isAns && <span style={{ color: '#10B981' }}>✓</span>}
              {submitted && sel && !isAns && <span style={{ color: '#EF4444' }}>✗</span>}
            </button>
          )
        })}
      </div>
      {submitted && (
        <div style={{ margin: '12px 16px 0', padding: '12px 16px', borderRadius: 10, background: isCorrect ? '#064E3B' : '#450A0A' }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{isCorrect ? '✅ 回答正确！' : '❌ 回答错误'}</div>
          {!isCorrect && <div style={{ fontSize: 14, marginTop: 4, color: '#FCA5A5' }}>正确答案：<strong style={{ color: '#4ADE80' }}>{q.answer}</strong></div>}
        </div>
      )}
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
        <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 6 }}>总进度：{done} / {total}（{Math.round(done / total * 100)}%）</div>
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

// ─── Backup Screen ─────────────────────────────────────────────────────────────
function BackupScreen({ progress, examDate, onRestore, onBack }) {
  const [restoreInput, setRestoreInput] = useState('')
  const [restoreMsg, setRestoreMsg] = useState('')
  const [tab, setTab] = useState('export')

  const exportCode = btoa(encodeURIComponent(JSON.stringify({ progress, examDate })))

  const copyExport = () => {
    navigator.clipboard.writeText(exportCode).then(() => {
      setRestoreMsg('已复制到剪贴板')
      setTimeout(() => setRestoreMsg(''), 2000)
    }).catch(() => setRestoreMsg('复制失败，请手动复制'))
  }

  const doImport = () => {
    try {
      const data = JSON.parse(decodeURIComponent(atob(restoreInput.trim())))
      if (!data.progress || typeof data.progress !== 'object') {
        setRestoreMsg('备份码格式无效')
        return
      }
      onRestore(data.progress, data.examDate || '')
      setRestoreMsg('✓ 导入成功')
      setTimeout(() => onBack(), 1000)
    } catch {
      setRestoreMsg('备份码格式无效')
    }
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <Btn icon onClick={onBack}>←</Btn>
        <div style={{ ...S.headerTitle, flex: 1, textAlign: 'center' }}>备份与恢复</div>
        <div style={{ width: 36 }} />
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', marginBottom: 16, background: '#0F172A', borderRadius: 10, padding: 3 }}>
          <button onClick={() => setTab('export')}
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: 14, background: tab === 'export' ? '#1E293B' : 'transparent', color: tab === 'export' ? '#F1F5F9' : '#64748B' }}>
            导出备份
          </button>
          <button onClick={() => setTab('import')}
            style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: 14, background: tab === 'import' ? '#1E293B' : 'transparent', color: tab === 'import' ? '#F1F5F9' : '#64748B' }}>
            导入备份
          </button>
        </div>

        {tab === 'export' ? (
          <>
            <div style={S.secTitle}>备份码</div>
            <div style={{ ...S.card, marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>复制此备份码保存到安全的地方，用于在其他设备恢复进度：</div>
              <div style={{
                background: '#0F172A', borderRadius: 8, padding: 14, wordBreak: 'break-all',
                fontFamily: 'monospace', fontSize: 13, color: '#3B82F6', lineHeight: 1.6, maxHeight: 200, overflowY: 'auto'
              }}>{exportCode}</div>
            </div>
            <button style={{ ...S.btnPrimary, width: '100%' }} onClick={copyExport}>复制备份码</button>
            {restoreMsg && <div style={{ color: '#10B981', fontSize: 13, textAlign: 'center', marginTop: 8 }}>{restoreMsg}</div>}
          </>
        ) : (
          <>
            <div style={S.secTitle}>粘贴备份码</div>
            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              <textarea value={restoreInput} onChange={e => setRestoreInput(e.target.value)}
                placeholder="粘贴备份码…" rows={5}
                style={{ ...S.input, fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }} />
              <button style={{ ...S.btnPrimary, width: '100%', opacity: restoreInput.trim() ? 1 : 0.4 }}
                disabled={!restoreInput.trim()} onClick={doImport}>导入并恢复进度</button>
            </div>
            {restoreMsg && (
              <div style={{ fontSize: 13, textAlign: 'center', marginTop: 8,
                color: restoreMsg.includes('成功') ? '#10B981' : '#EF4444' }}>{restoreMsg}</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Debug Screen ──────────────────────────────────────────────────────────────
function DebugScreen({ diagnostic }) {
  const [copied, setCopied] = useState(false)

  if (!diagnostic) {
    return (
      <div style={D.page}>
        <div style={{ color: '#94A3B8', fontSize: 18 }}>读取 localStorage 中…</div>
      </div>
    )
  }

  const { keys, quizProgressRaw, capturedAt } = diagnostic
  const keyEntries = Object.entries(keys)
  let progParsed = null
  let progCount = 0
  try {
    progParsed = JSON.parse(quizProgressRaw || '{}')
    progCount = Object.keys(progParsed).length
  } catch {}

  const fullData = btoa(encodeURIComponent(JSON.stringify({ capturedAt, keys, quizProgressParsed: progParsed })))

  const copyAll = () => {
    navigator.clipboard.writeText(fullData).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }).catch(() => setCopied(false))
  }

  return (
    <div style={D.page}>
      <div style={D.header}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#F1F5F9' }}>诊断面板</div>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
            快照时间：{capturedAt}　｜　共 {keyEntries.length} 个 key
          </div>
        </div>
        <button style={D.copyBtn} onClick={copyAll}>{copied ? '✓ 已复制' : '复制全部'}</button>
      </div>

      {/* quiz_progress highlight */}
      <div style={D.section}>
        <div style={{ ...D.sectionTitle, color: '#FBBF24' }}>quiz_progress ({progCount} 条答题记录)</div>
        <div style={D.codeBlock}>{quizProgressRaw || '(空)'}</div>
      </div>

      {/* All keys */}
      {keyEntries.map(([k, v]) => (
        <div key={k} style={{ ...D.section, ...(k === 'quiz_progress' ? { display: 'none' } : {}) }}>
          <div style={D.sectionTitle}>{k}</div>
          <div style={D.codeBlock}>{v || '(空)'}</div>
        </div>
      ))}

      {/* Encoded full data */}
      <div style={D.section}>
        <div style={{ ...D.sectionTitle, color: '#3B82F6' }}>编码后的完整数据（可复制发送）</div>
        <div style={{ ...D.codeBlock, color: '#3B82F6', fontSize: 12 }}>{fullData}</div>
      </div>

      <div style={{ padding: 32, textAlign: 'center' }}>
        <button style={{ background: '#1E293B', border: '1px solid #334155', borderRadius: 10, color: '#94A3B8', padding: '10px 24px', fontSize: 14, cursor: 'pointer' }}
          onClick={copyAll}>{copied ? '✓ 已复制全部数据' : '复制全部'}</button>
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
    <button onClick={onClick} style={{ background: 'transparent', color: '#94A3B8', fontSize: icon ? 18 : 14, padding: '4px 8px', borderRadius: 6, border: 'none', cursor: 'pointer' }}>
      {children}
    </button>
  )
}

// ─── Debug Styles ──────────────────────────────────────────────────────────────
const D = {
  page: { minHeight: '100vh', background: '#0A0E14', padding: '16px 16px 32px', maxWidth: 600, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid #1E293B' },
  copyBtn: { background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0 },
  section: { marginBottom: 16, background: '#111827', borderRadius: 10, padding: 14 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#94A3B8', marginBottom: 8, wordBreak: 'break-all' },
  codeBlock: { background: '#0A0E14', borderRadius: 8, padding: 12, fontSize: 14, fontFamily: 'monospace', color: '#CBD5E1', lineHeight: 1.7, wordBreak: 'break-all', whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: 320, overflowY: 'auto' },
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
  btnPrimary: { background: '#3B82F6', color: '#fff', padding: '13px 24px', borderRadius: 10, fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer' },
  btnGhost: { background: 'transparent', color: '#475569', padding: '10px', borderRadius: 8, fontSize: 13, border: 'none', cursor: 'pointer' },
  chip: { padding: '7px 16px', borderRadius: 20, border: '1px solid #334155', background: 'transparent', color: '#94A3B8', fontSize: 13, cursor: 'pointer' },
  chipActive: { background: '#3B82F6', borderColor: '#3B82F6', color: '#fff' },
  typeBadge: { display: 'inline-block', fontSize: 12, padding: '3px 10px', borderRadius: 20, fontWeight: 600 },
  stem: { fontSize: 16, lineHeight: 1.8, color: '#E2E8F0', whiteSpace: 'pre-wrap' },
  optBtn: { display: 'flex', alignItems: 'center', gap: 12, background: '#1E293B', border: '1.5px solid #334155', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', width: '100%', transition: 'all .15s' },
  examEntryBtn: { width: '100%', background: '#1E293B', border: '1px solid #334155', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' },
  examTimerBar: { display: 'flex', alignItems: 'center', padding: '10px 16px', gap: 8 },
  examTimer: { fontSize: 22, fontWeight: 900, letterSpacing: 2, fontVariantNumeric: 'tabular-nums' },
  modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100, padding: '0 0 0 0' },
  modalCard: { background: '#1E293B', borderRadius: '16px 16px 0 0', padding: 24, width: '100%', maxWidth: 480 },
}
