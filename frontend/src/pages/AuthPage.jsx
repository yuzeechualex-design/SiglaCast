export default function AuthPage({
  mode,
  setMode,
  email,
  setEmail,
  password,
  setPassword,
  name,
  setName,
  course,
  setCourse,
  notice,
  loading,
  onLogin,
  onRegister
}) {
  function onSubmit(event) {
    event.preventDefault();
    if (mode === "login") onLogin();
    else onRegister();
  }

  return (
    <div className="app auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>SiglaCast</h1>
        <p className="auth-tagline">A voting community for SiglaCast — campus events, polls, and updates in one place.</p>
        <div className="auth-tabs">
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Login</button>
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Register</button>
        </div>
        {mode === "register" && (
          <>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="Course" />
          </>
        )}
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="University email" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
        <button type="submit" disabled={loading}>{loading ? "Please wait..." : (mode === "login" ? "Sign In" : "Create Account")}</button>
        {notice ? <span className="badge auth-notice">{notice}</span> : null}
      </form>
    </div>
  );
}
