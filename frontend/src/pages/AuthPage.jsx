import { useEffect, useState } from "react";
import {
  normalizeRegistrationEmail,
  passwordRequirementStatus,
  registrationEmailDomainFromEnv,
  validateRegisterForm
} from "../utils/registerValidation.js";
import { DEFAULT_API_BASE_URL } from "../services/api.js";

export default function AuthPage({
  mode,
  setMode,
  email,
  setEmail,
  password,
  setPassword,
  name,
  setName,
  notice,
  clearNotice,
  loading,
  onLogin,
  onRegister
}) {
  /** @type {Record<string, string>} */
  const [fieldErrors, setFieldErrors] = useState({});

  const emailDomain = registrationEmailDomainFromEnv();
  const passwordChecks = passwordRequirementStatus(password);

  useEffect(() => {
    setFieldErrors({});
  }, [mode]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${DEFAULT_API_BASE_URL}/api/health`, { signal: controller.signal }).catch(() => {});
    return () => controller.abort();
  }, []);

  function onSubmit(event) {
    event.preventDefault();
    if (mode === "login") {
      onLogin();
      return;
    }
    clearNotice?.();
    const v = validateRegisterForm({ name, email, password });
    if (!v.ok) {
      setFieldErrors(v.fieldErrors);
      return;
    }
    setFieldErrors({});
    onRegister(v.normalized);
  }

  const [socialProvider, setSocialProvider] = useState(null); // "google" | "apple" | null
  const [showEmailForm, setShowEmailForm] = useState(false);

  useEffect(() => {
    setFieldErrors({});
    setSocialProvider(null);
    setShowEmailForm(false);
  }, [mode]);

  return (
    <div className="auth-page-container">
      <div className="auth-bg-grid" />
      <img className="auth-bg-mark auth-bg-mark-one" src="/assets/siglacast-splash.png" alt="" />
      <img className="auth-bg-mark auth-bg-mark-two" src="/assets/siglacast-icon.png" alt="" />
      
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-brand">
          <img src="/assets/siglacast-icon.png" alt="" />
          <h1>SiglaCast</h1>
        </div>

        {socialProvider ? (
          <div className="auth-social-picker">
            <div className="auth-social-picker-header">
              <button
                type="button"
                className="auth-social-picker-back"
                onClick={() => setSocialProvider(null)}
                aria-label="Back"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12" />
                  <polyline points="12,19 5,12 12,5" />
                </svg>
              </button>
              <div className="auth-social-picker-logo">
                {socialProvider === "google" ? (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84c-.21 1.12-.84 2.07-1.79 2.7v2.24h2.9c1.69-1.56 2.69-3.85 2.69-6.59z" fill="#4285F4" />
                    <path d="M9 18c2.43 0 4.47-.8 5.96-2.2l-2.9-2.24c-.8.54-1.84.87-3.06.87-2.35 0-4.34-1.59-5.05-3.73H.91v2.31C2.39 15.96 5.48 18 9 18z" fill="#34A853" />
                    <path d="M3.95 10.7C3.77 10.16 3.67 9.59 3.67 9s.1-1.16.28-1.7V4.99H.91C.33 6.19 0 7.56 0 9s.33 2.81.91 4.01l3.04-2.31z" fill="#FBBC05" />
                    <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35L15 2.4C13.46.97 11.42 0 9 0 5.48 0 2.39 2.04.91 4.99l3.04 2.31C4.66 5.17 6.65 3.58 9 3.58z" fill="#EA4335" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                    <path d="M15.545 9.773c-.023-2.091 1.706-3.093 1.785-3.144-1.01-1.428-2.584-1.626-3.14-1.66-1.34-.131-2.617.755-3.295.755-.678 0-1.74-.74-2.85-.719-1.462.022-2.812.822-3.565 2.083-1.52 2.536-.388 6.277 1.093 8.328.724 1.002 1.579 2.126 2.709 2.085 1.09-.04 1.503-.674 2.822-.674 1.319 0 1.693.674 2.825.652 1.152-.02 1.907-1.018 2.613-2.008.816-1.149 1.152-2.261 1.171-2.318-.024-.01-2.298-.845-2.321-3.38zM12.983 2.91c.602-.702.996-1.685.885-2.66-.875.033-1.938.562-2.564 1.264-.563.629-.982 1.626-.855 2.583.974.072 1.932-.485 2.534-1.187z" />
                  </svg>
                )}
              </div>
            </div>
            <h2 className="auth-social-picker-title">Sign in with {socialProvider === "google" ? "Google" : "Apple"}</h2>
            <p className="auth-social-picker-subtitle">to continue to SiglaCast</p>
            <div className="auth-social-picker-list">
              <button
                type="button"
                className="auth-social-picker-item"
                onClick={() => {
                  setSocialProvider(null);
                  onLogin("ana@dorsu.edu.ph", "student123");
                }}
              >
                <div className="auth-social-picker-avatar">A</div>
                <div className="auth-social-picker-item-info">
                  <span className="auth-social-picker-item-name">Ana (Demo Student)</span>
                  <span className="auth-social-picker-item-email">ana@dorsu.edu.ph</span>
                </div>
              </button>
              <button
                type="button"
                className="auth-social-picker-item"
                onClick={() => {
                  setSocialProvider(null);
                  onLogin("admin@dorsu.edu.ph", "admin123");
                }}
              >
                <div className="auth-social-picker-avatar">S</div>
                <div className="auth-social-picker-item-info">
                  <span className="auth-social-picker-item-name">Admin (Demo Faculty)</span>
                  <span className="auth-social-picker-item-email">admin@dorsu.edu.ph</span>
                </div>
              </button>
              <button
                type="button"
                className="auth-social-picker-new"
                onClick={() => {
                  const rand = Math.random().toString(36).slice(2, 7);
                  const mockEmail = `${socialProvider}.user.${rand}@dorsu.edu.ph`;
                  const mockPassword = `socialPass_${rand}!`;
                  const mockName = `${socialProvider === "google" ? "Google" : "Apple"} User ${rand}`;
                  setSocialProvider(null);
                  onRegister({ name: mockName, email: mockEmail, password: mockPassword }, true);
                }}
              >
                ＋ Continue as a new {socialProvider === "google" ? "Google" : "Apple"} account
              </button>
            </div>
          </div>
        ) : !showEmailForm ? (
          <div className="auth-social-view">
            <div className="auth-tabs">
              <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
                Login
              </button>
              <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
                Register
              </button>
            </div>
            
            <h2 className="auth-social-title">
              {mode === "register" ? "Get access to 10M+ Characters" : "Welcome Back"}
            </h2>
            <p className="auth-social-subtitle">
              {mode === "register" ? "Sign up in just ten seconds" : "Sign in in just ten seconds"}
            </p>

            <div className="auth-social-btns-list">
              <button
                type="button"
                className="btn-social btn-social-google"
                onClick={() => setSocialProvider("google")}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.49h4.84c-.21 1.12-.84 2.07-1.79 2.7v2.24h2.9c1.69-1.56 2.69-3.85 2.69-6.59z" fill="#4285F4" />
                  <path d="M9 18c2.43 0 4.47-.8 5.96-2.2l-2.9-2.24c-.8.54-1.84.87-3.06.87-2.35 0-4.34-1.59-5.05-3.73H.91v2.31C2.39 15.96 5.48 18 9 18z" fill="#34A853" />
                  <path d="M3.95 10.7C3.77 10.16 3.67 9.59 3.67 9s.1-1.16.28-1.7V4.99H.91C.33 6.19 0 7.56 0 9s.33 2.81.91 4.01l3.04-2.31z" fill="#FBBC05" />
                  <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35L15 2.4C13.46.97 11.42 0 9 0 5.48 0 2.39 2.04.91 4.99l3.04 2.31C4.66 5.17 6.65 3.58 9 3.58z" fill="#EA4335" />
                </svg>
                <span>Continue with Google</span>
              </button>

              <button
                type="button"
                className="btn-social btn-social-apple"
                onClick={() => setSocialProvider("apple")}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
                  <path d="M15.545 9.773c-.023-2.091 1.706-3.093 1.785-3.144-1.01-1.428-2.584-1.626-3.14-1.66-1.34-.131-2.617.755-3.295.755-.678 0-1.74-.74-2.85-.719-1.462.022-2.812.822-3.565 2.083-1.52 2.536-.388 6.277 1.093 8.328.724 1.002 1.579 2.126 2.709 2.085 1.09-.04 1.503-.674 2.822-.674 1.319 0 1.693.674 2.825.652 1.152-.02 1.907-1.018 2.613-2.008.816-1.149 1.152-2.261 1.171-2.318-.024-.01-2.298-.845-2.321-3.38zM12.983 2.91c.602-.702.996-1.685.885-2.66-.875.033-1.938.562-2.564 1.264-.563.629-.982 1.626-.855 2.583.974.072 1.932-.485 2.534-1.187z" />
                </svg>
                <span>Continue with Apple</span>
              </button>
            </div>

            <div className="auth-separator">OR</div>

            <button
              type="button"
              className="btn-social btn-social-email"
              onClick={() => setShowEmailForm(true)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <span>Continue with email</span>
            </button>

            <p className="auth-footnote">
              By continuing, you agree with the <a href="#terms">Terms</a> and <a href="#privacy">Privacy Policy</a>
            </p>
          </div>
        ) : (
          <div className="auth-email-view" style={{ display: "flex", flexDirection: "column", width: "100%" }}>
            <button
              type="button"
              className="auth-back-link"
              onClick={() => setShowEmailForm(false)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12,19 5,12 12,5" />
              </svg>
              <span>Back to sign-in options</span>
            </button>

            <div className="auth-tabs">
              <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
                Login
              </button>
              <button
                type="button"
                className={mode === "register" ? "active" : ""}
                onClick={() => setMode("register")}
              >
                Register
              </button>
            </div>

            {mode === "register" && (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full name"
                  name="name"
                  autoComplete="name"
                  aria-invalid={!!fieldErrors.name}
                  aria-describedby={fieldErrors.name ? "err-name" : undefined}
                />
                {fieldErrors.name ? (
                  <p id="err-name" className="auth-field-error" role="alert">
                    {fieldErrors.name}
                  </p>
                ) : null}
              </>
            )}

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={(e) => setEmail(normalizeRegistrationEmail(e.target.value))}
              placeholder="Gmail address"
              name="email"
              inputMode="email"
              autoComplete={mode === "login" ? "email" : "username"}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? "hint-email err-email" : "hint-email"}
            />
            <p id="hint-email" className="auth-field-hint">
              {emailDomain ? <>Use an email ending in <strong>@{emailDomain}</strong>.</> : "Enter a valid email address."}
            </p>
            {fieldErrors.email ? (
              <p id="err-email" className="auth-field-error" role="alert">
                {fieldErrors.email}
              </p>
            ) : null}

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "login" ? "Password" : "Create a strong password"}
              name="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={mode === "register" ? "password-hints" : fieldErrors.password ? "err-pass" : undefined}
            />
            {mode === "register" ? (
              <ul id="password-hints" className="auth-password-hints" aria-label="Password requirements">
                {passwordChecks.map((row) => (
                  <li key={row.key} className={row.ok ? "ok" : ""}>
                    {row.label}
                  </li>
                ))}
              </ul>
            ) : null}
            {fieldErrors.password ? (
              <p id="err-pass" className="auth-field-error" role="alert">
                {fieldErrors.password}
              </p>
            ) : null}

            <button type="submit" disabled={loading}>
              {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </div>
        )}

        {notice ? <span className="badge auth-notice">{notice}</span> : null}
      </form>
    </div>
  );
}
