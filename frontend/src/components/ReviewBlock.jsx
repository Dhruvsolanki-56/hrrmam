import { useMe } from '../context'
import { MiniHistory } from './Timeline'
import { fmtDateTime, isMine, orList, toYou } from './bits'

const SINCE = (iso) => {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return days >= 1 ? ` (${days} day${days === 1 ? '' : 's'} ago)` : ''
}

/** Who has this item, who sent it and when, what they must do next, and, if it was sent back, who sent it back and why.
 *  Each fact is said once: a returned item shows the reason box and the next step, not "returned" three more times. */
export default function ReviewBlock({ review, step, kind = 'item', history = true }) {
  const me = useMe()
  if (!review) return null
  const w = review.with
  const back = !!review.changes
  const verb = { approve: 'Waiting for approval from', review: 'Waiting for review by', fix: 'Back with', work: 'With' }[w?.action] || 'With'
  const mine = isMine(review.next, me)
  return (
    <div className="rvblock">
      {step && !back && <p className="rv-step"><span>Current step</span><b>{step}</b></p>}
      {w && w.people.length > 0 && !back && (
        <p className="rv-with">
          <span>{verb}</span><b>{orList(w.people)}</b>{w.since ? <small>since {fmtDateTime(w.since)}{SINCE(w.since)}</small> : null}
        </p>
      )}
      {review.submitted && w?.action !== 'fix' && <p className="rv-line"><span>Submitted by</span> {review.submitted.by}, {fmtDateTime(review.submitted.at)}{review.submitted.note ? <> · “{review.submitted.note}”</> : null}</p>}
      {back && (
        <div className="sentback" role="note">
          <b>Changes requested by {review.changes.by}, {fmtDateTime(review.changes.at)}</b>
          <p>Reason: “{review.changes.note || 'No reason was written.'}”</p>
        </div>
      )}
      {review.next && <p className={`rv-next ${mine ? 'mine' : ''}`}><span>{mine ? 'Your next step' : 'Next'}</span> {toYou(review.next, me)}</p>}
      {review.decided && <p className="rv-line"><span>Approved by</span> {review.decided.by}, {fmtDateTime(review.decided.at)}{review.decided.note ? <> · “{review.decided.note}”</> : null}</p>}
      {history && review.history?.length > 0 && (
        <details className="more rv-hist">
          <summary>History of this {kind} ({review.history.length})</summary>
          <MiniHistory rows={review.history} />
        </details>
      )}
    </div>
  )
}
