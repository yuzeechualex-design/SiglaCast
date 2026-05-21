import { Link } from "react-router-dom";

export default function DownloadPage() {
  return (
    <main className="download-page">
      <nav className="download-nav" aria-label="Download page">
        <Link className="download-brand" to="/download" aria-label="SiglaCast download home">
          <img src="/assets/siglacast-icon.png" alt="" />
          <span>SiglaCast</span>
        </Link>
        <div className="download-nav-links">
          <a href="#features">Features</a>
          <a href="#screens">Screens</a>
          <Link to="/">Open app</Link>
        </div>
      </nav>

      <section className="download-hero">
        <img className="download-bg-mark download-bg-mark-one" src="/assets/siglacast-splash.png" alt="" />
        <img className="download-bg-mark download-bg-mark-two" src="/assets/siglacast-icon.png" alt="" />
        <div className="download-hero-copy">
          <p className="download-eyebrow">Community, music, messages, stories</p>
          <h1>DOWNLOAD SIGLACAST WHEREVER YOU HANG OUT</h1>
          <p className="download-subtitle">
            Bring your community feed, chats, music status, events, and profile updates into one fast Android app.
          </p>
          <div className="download-actions">
            <a className="download-primary-btn" href="/downloads/siglacast.apk" download>
              <span aria-hidden="true">↓</span>
              <span>Download app</span>
            </a>
            <Link className="download-secondary-btn" to="/">
              Open web app
            </Link>
          </div>
        </div>

        <div className="download-showcase" aria-label="SiglaCast app screenshots">
          <div className="download-desktop-shot">
            <div className="shot-topbar">
              <span />
              <span />
              <span />
            </div>
            <div className="shot-hero">
              <strong>SiglaCast</strong>
              <small>Community Platform</small>
            </div>
            <div className="shot-tabs">
              <span>Community</span>
              <span>Messages</span>
              <span>Music</span>
            </div>
            <div className="shot-feed">
              <article>
                <b>Community Feed</b>
                <p>Share updates, photos, and reactions with the community.</p>
              </article>
              <article>
                <b>Yuwrzeh</b>
                <p>pag-iwas (nahuhulog)</p>
              </article>
            </div>
          </div>

          <div className="download-phone-shot">
            <div className="phone-notch" />
            <div className="phone-card phone-profile">
              <div className="phone-cover" />
              <div className="phone-avatar" />
              <strong>yuze</strong>
              <span>Online · listening</span>
            </div>
            <div className="phone-card phone-post">
              <b>What is on your mind?</b>
              <p>Stories, reactions, comments, and shares.</p>
              <div className="phone-reactions">👍 ❤️ 😂 😮 😢</div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="download-feature-band">
        <div>
          <strong>Pull to refresh</strong>
          <span>Load fresh posts and conversations with a quick swipe.</span>
        </div>
        <div>
          <strong>Real-time feel</strong>
          <span>Messages, notifications, stories, and reactions stay close.</span>
        </div>
        <div>
          <strong>Made for Android</strong>
          <span>Designed around mobile posting, chatting, and quick navigation.</span>
        </div>
      </section>

      <section id="screens" className="download-screen-grid">
        <article>
          <span>Community</span>
          <strong>Posts, stories, reactions</strong>
          <p>Publish updates, react fast, and keep conversations moving.</p>
        </article>
        <article>
          <span>Profile</span>
          <strong>Your status, music, and posts</strong>
          <p>Show your current vibe with profile details and music sharing.</p>
        </article>
        <article>
          <span>Messages</span>
          <strong>DMs and group chats</strong>
          <p>Find people, create groups, and keep files inside the thread.</p>
        </article>
      </section>
    </main>
  );
}
