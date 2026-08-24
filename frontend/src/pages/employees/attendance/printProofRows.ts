/**
 * Rows for `scripts/print-proof.mjs`, the printed-geometry check.
 *
 * The unit and post names are the real production org structure, because that
 * is what stresses the layout — long Arabic post names, one post carrying a
 * whole platoon, and two companies on the same calendar day. Every person is
 * invented (the G9xxx block), so this file carries no personal data.
 *
 * Shaped to 20 Aug 2026, whose real register is a noon company and a night
 * company: the case a printed sheet must never collapse into one.
 */
import type { AttendanceRow } from './attendanceModel'

const FIRST = [
  'Ahmed', 'Mohammed', 'Khalid', 'Saeed', 'Rashid', 'Hamdan', 'Sultan', 'Majid',
  'Yousef', 'Omar', 'Salem', 'Faisal', 'Tariq', 'Nasser', 'Adel', 'Hassan',
  'Jassim', 'Marwan', 'Zayed', 'Badr', 'Hamad', 'Fahad', 'Ibrahim', 'Waleed',
]
const FIRST_AR = [
  'أحمد', 'محمد', 'خالد', 'سعيد', 'راشد', 'حمدان', 'سلطان', 'ماجد',
  'يوسف', 'عمر', 'سالم', 'فيصل', 'طارق', 'ناصر', 'عادل', 'حسن',
  'جاسم', 'مروان', 'زايد', 'بدر', 'حمد', 'فهد', 'إبراهيم', 'وليد',
]
const LAST = [
  'Al Mansoori', 'Al Balushi', 'Al Zaabi', 'Al Hammadi', 'Al Suwaidi',
  'Al Marzouqi', 'Al Ketbi', 'Al Nuaimi', 'Al Shamsi', 'Al Kaabi',
]
const LAST_AR = [
  'المنصوري', 'البلوشي', 'الزعابي', 'الحمادي', 'السويدي',
  'المرزوقي', 'الكتبي', 'النعيمي', 'الشامسي', 'الكعبي',
]

interface ShiftPlan {
  code: string
  unit: string
  /** UTC-naive, exactly as the API publishes them. Asia/Dubai is UTC+4. */
  start: string
  end: string
  absenceDue: string
  judgmentDue: string
  posts: ReadonlyArray<readonly [string, number]>
}

const PLAN: readonly ShiftPlan[] = [
  {
    code: 'noon',
    unit: 'السرية الرابعة',
    start: '2026-08-20T09:00:00',
    end: '2026-08-20T17:00:00',
    absenceDue: '2026-08-20T10:00:00',
    judgmentDue: '2026-08-20T19:00:00',
    posts: [
      ['ليوان', 24],
      ['تفتيش', 6],
      ['عمليات', 3],
      ['عريف طابق', 2],
      ['ماستركي', 1],
      ['مسؤول سرية', 1],
      ['وكيل سرية', 1],
    ],
  },
  {
    code: 'night',
    unit: 'السرية الثالثة',
    start: '2026-08-20T17:00:00',
    end: '2026-08-21T01:00:00',
    absenceDue: '2026-08-20T18:00:00',
    judgmentDue: '2026-08-21T03:00:00',
    posts: [
      ['ليوان', 23],
      ['تفتيش', 6],
      ['عمليات', 3],
      ['عريف طابق', 2],
      ['ماستركي', 1],
      ['مسؤول سرية', 1],
      ['وكيل سرية متدرب', 1],
    ],
  },
]

/** Seeded, so a layout change is the only thing that can move the output. */
function sequence(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

function shiftIso(iso: string, minutes: number): string {
  const at = new Date(`${iso}Z`)
  at.setUTCMinutes(at.getUTCMinutes() + minutes)
  return at.toISOString().slice(0, 19)
}

function build(): AttendanceRow[] {
  const next = sequence(20260820)
  const rows: AttendanceRow[] = []
  let gnumber = 9001
  for (const plan of PLAN) {
    for (const [post, headcount] of plan.posts) {
      for (let index = 0; index < headcount; index += 1) {
        const name = Math.floor(next() * FIRST.length)
        const family = Math.floor(next() * LAST.length)
        const roll = next()

        // A realistic spread of every state the ladder can reach, so no branch
        // of the layout goes unexercised.
        let lateMinutes = 0
        let firstPunch: string | null = shiftIso(plan.start, -Math.floor(next() * 20) - 2)
        let lastPunch: string | null = shiftIso(plan.end, Math.floor(next() * 12))
        let punchCount = 2
        let onLeave = false
        if (roll > 0.72 && roll <= 0.82) {
          lateMinutes = Math.floor(next() * 26) + 2 // inside a 30-minute grace
          firstPunch = shiftIso(plan.start, lateMinutes)
        } else if (roll > 0.82 && roll <= 0.9) {
          lateMinutes = Math.floor(next() * 55) + 31 // past the grace
          firstPunch = shiftIso(plan.start, lateMinutes)
        } else if (roll > 0.9 && roll <= 0.945) {
          punchCount = 1 // a hole in the record
          lastPunch = null
        } else if (roll > 0.945 && roll <= 0.98) {
          punchCount = 0
          firstPunch = null
          lastPunch = null
        } else if (roll > 0.98) {
          punchCount = 0
          firstPunch = null
          lastPunch = null
          onLeave = true
        }

        rows.push({
          employee_id: `G${gnumber++}`,
          name_en: `${FIRST[name]} ${LAST[family]}`,
          name_ar: `${FIRST_AR[name]} ${LAST_AR[family]}`,
          department: 'الأمن',
          duty_unit: plan.unit,
          duty_post: post,
          crew_code: null,
          shift_code: plan.code,
          presence_state: punchCount > 0 ? 'completed' : onLeave ? 'excused_leave' : 'absent',
          reason_code: null,
          scheduled_start_at: plan.start,
          scheduled_end_at: plan.end,
          first_punch_at: firstPunch,
          last_punch_at: lastPunch,
          punch_count: punchCount,
          late_minutes: lateMinutes,
          grace_minutes: 30,
          absence_due_at: plan.absenceDue,
          judgment_due_at: plan.judgmentDue,
          on_leave: onLeave,
        } as AttendanceRow)
      }
    }
  }
  return rows
}

export const ROWS: AttendanceRow[] = build()
