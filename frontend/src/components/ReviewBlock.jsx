import { MiniHistory } from './Timeline'
import { fmtDateTime, orList } from './bits'

const SINCE = (iso) => {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return days >= 1 ? ` (${days} day${days === 1 ? '' : 's'} ago)` : ''
}

/** Who has this item, who sent it and when, what they must do next, and, if it was sent back, who sent it back and why. */
export default function ReviewBlock({ review, step, kind = 'item', history = true }) {
  if (!review) return null
  const w = review.with
  const verb = { approve: 'Waiting for approval from', review: 'Waiting for review by', fix: 'Back with', work: 'With' }[w?.action] || 'With'
  return (
    <div className="rvblock">
      {step && <p className="rv-step"><span>Current step</span><b>{step}</b></p>}
      {w && w.people.length > 0 && (
        <p className="rv-with">
          <span>{verb}</span><b>{orList(w.people)}</b>{w.since ? <small>since {fmtDateTime(w.since)}{SINCE(w.since)}</small> : null}
        </p>
      )}
      {review.submitted && w?.action !== 'fix' && <p className="rv-line"><span>Submitted by</span> {review.submitted.by}, {fmtDateTime(review.submitted.at)}{review.submitted.note ? <> · “{review.submitted.note}”</> : null}</p>}
      {review.changes && (
        <div className="sentback" role="note">
          <b>Changes requested by {review.changes.by}, {fmtDateTime(review.changes.at)}</b>
          <p>Reason: “{review.changes.note || 'No reason was written.'}”</p>
          <small>To be corrected by {review.changes.fixer || 'the owner'}, then submitted again.</small>
        </div>
      )}
      {review.next && <p className="rv-next"><span>Next action</span> {review.next}</p>}
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
