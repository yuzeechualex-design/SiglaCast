export default function DashboardPage({
  user,
  dashboard,
  newEventTitle,
  setNewEventTitle,
  newEventDesc,
  setNewEventDesc,
  newEventRules,
  setNewEventRules,
  newEventMaxVotes,
  setNewEventMaxVotes,
  newEventStrategy,
  setNewEventStrategy,
  newEventCandidates,
  setNewEventCandidates,
  newCandidateImageUrls,
  setNewCandidateImageUrls,
  newEventCoverFile,
  setNewEventCoverFile,
  onCreateEvent
}) {
  if (!dashboard) return null;

  return (
    <section className="panel single">
      <div className="panel-head">
        <h2>📊 {user.role === "admin" ? "Admin Dashboard" : "Student Dashboard"}</h2>
        <p>Overview metrics and current system activity.</p>
      </div>
      <div className="metric-grid">
        {Object.entries(dashboard.metrics || {}).map(([key, value]) => (
          <article key={key} className="tile">
            <small>{key.replace(/([A-Z])/g, " $1")}</small>
            <h3>{value}</h3>
          </article>
        ))}
      </div>
      {user.role === "admin" && (
        <div className="composer admin-event-form">
          <h3>➕ Create detailed event</h3>
          <p className="form-hint">Set how many times each user may vote, add a cover image, and optional candidate photos (URLs, same order as names).</p>

          <label className="field-label">Title</label>
          <input value={newEventTitle} onChange={(e) => setNewEventTitle(e.target.value)} placeholder="Event title" />

          <label className="field-label">Description</label>
          <textarea value={newEventDesc} onChange={(e) => setNewEventDesc(e.target.value)} rows={3} placeholder="What is this event about?" />

          <label className="field-label">Rules & instructions</label>
          <textarea value={newEventRules} onChange={(e) => setNewEventRules(e.target.value)} rows={3} placeholder="Voting rules, eligibility, deadlines…" />

          <div className="form-row">
            <div className="form-col">
              <label className="field-label">Votes per user</label>
              <select value={newEventMaxVotes} onChange={(e) => setNewEventMaxVotes(e.target.value)}>
                <option value="1">1 — one vote only</option>
                <option value="2">2 votes per person</option>
                <option value="3">3 votes per person</option>
                <option value="5">5 votes per person</option>
                <option value="0">Unlimited</option>
              </select>
            </div>
            <div className="form-col">
              <label className="field-label">Tally mode</label>
              <select value={newEventStrategy} onChange={(e) => setNewEventStrategy(e.target.value)}>
                <option value="single">Standard count</option>
                <option value="weighted">Weighted points</option>
              </select>
            </div>
          </div>

          <label className="field-label">Candidates (comma-separated)</label>
          <input value={newEventCandidates} onChange={(e) => setNewEventCandidates(e.target.value)} placeholder="Team A, Team B, Team C" />

          <label className="field-label">Candidate image URLs (optional, comma-aligned)</label>
          <input value={newCandidateImageUrls} onChange={(e) => setNewCandidateImageUrls(e.target.value)} placeholder="/uploads/photo1.jpg, , /uploads/photo3.png" />

          <label className="field-label">Cover image (optional)</label>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setNewEventCoverFile(e.target.files?.[0] || null)}
          />
          {newEventCoverFile ? <small className="file-picked">Selected: {newEventCoverFile.name}</small> : null}

          <button type="button" className="btn btn-primary" onClick={onCreateEvent}>➕ Publish event</button>
        </div>
      )}
    </section>
  );
}
