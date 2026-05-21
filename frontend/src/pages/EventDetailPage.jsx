import { mediaUrl } from "../services/api.js";

export default function EventDetailPage({ selectedEvent, onVote, liteMode = false }) {
  if (!selectedEvent) {
    return (
      <section className="panel single">
        <div className="panel-head">
          <h2>📊 Event detail + live tally</h2>
          <p>Select an event from the Events page.</p>
        </div>
      </section>
    );
  }

  const {
    title,
    description,
    rules,
    candidates = [],
    coverImageUrl,
    voteLimitLabel,
    maxVotesPerUser,
    myVotes = [],
    myVoteCount = 0,
    totalVotes = 0
  } = selectedEvent;

  const canVote = maxVotesPerUser === 0 || myVoteCount < maxVotesPerUser;
  const denom = Math.max(totalVotes, 1);

  return (
    <section className="panel single event-detail">
      <div className="panel-head">
        <h2>📊 Event detail + live tally</h2>
        <p className="event-detail-title">{title}</p>
      </div>

      {coverImageUrl && !liteMode ? (
        <div className="event-cover-wrap">
          <img className="event-cover" src={mediaUrl(coverImageUrl)} alt="" />
        </div>
      ) : null}

      <div className="event-detail-meta">
        <span className="pill">📌 {voteLimitLabel}</span>
        <span className="pill pill-muted">📈 {totalVotes} total vote{totalVotes === 1 ? "" : "s"}</span>
        {myVoteCount > 0 ? (
          <span className="pill pill-you">✓ You: {myVoteCount} cast</span>
        ) : null}
      </div>

      {description ? (
        <div className="event-section">
          <h3>About</h3>
          <p className="event-body">{description}</p>
        </div>
      ) : null}

      {rules ? (
        <div className="event-section event-rules">
          <h3>Rules & instructions</h3>
          <p className="event-body">{rules}</p>
        </div>
      ) : null}

      <div className="event-section">
        <h3>Live results</h3>
        <p className="event-hint">Bars show each candidate&apos;s share of all votes (updates every few seconds).</p>
      </div>

      {candidates.map((candidate) => {
        const votes = candidate.votes ?? 0;
        const pct = Math.round((votes / denom) * 1000) / 10;
        const votedThis = myVotes.includes(candidate.id);
        return (
          <article key={candidate.id} className={`tile tally-card ${votedThis ? "tally-card-voted" : ""}`}>
            <div className="tally-card-top">
              <div className="tally-candidate">
                {candidate.imageUrl && !liteMode ? (
                  <img className="tally-cand-img" src={mediaUrl(candidate.imageUrl)} alt="" />
                ) : (
                  <div className="tally-cand-img placeholder">{candidate.name?.charAt(0) || "?"}</div>
                )}
                <div>
                  <strong className="tally-name">{candidate.name}</strong>
                  <div className="tally-count">{votes} vote{votes === 1 ? "" : "s"} · {pct}% of total</div>
                </div>
              </div>
              <button
                type="button"
                className={`btn btn-vote ${votedThis ? "btn-voted" : ""}`}
                disabled={!canVote}
                onClick={() => onVote(selectedEvent.id, candidate.id)}
              >
                {votedThis ? "✓ Voted" : "🗳️ Vote"}
              </button>
            </div>
            <div className="tally-bar-track" aria-hidden>
              <div className="tally-bar-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
          </article>
        );
      })}

      {!canVote ? (
        <p className="event-limit-note">You have reached the maximum votes allowed for this event.</p>
      ) : null}
    </section>
  );
}
