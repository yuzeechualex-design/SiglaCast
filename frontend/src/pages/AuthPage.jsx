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
  onRegister,
  onSocialLogin
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

  const [showEmailForm, setShowEmailForm] = useState(false);

  useEffect(() => {
    setFieldErrors({});
    setShowEmailForm(false);
  }, [mode]);

  return (
    <div className="auth-page-container">
      <div className="auth-bg-grid" />
      <img className="auth-bg-mark auth-bg-mark-one" src="/assets/purxu-logo.png" alt="" />
      <img className="auth-bg-mark auth-bg-mark-two" src="/assets/purxu-logo.png" alt="" />
      
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-brand">
          <img src="/assets/purxu-logo.png" alt="" />
          <h1>purxu</h1>
        </div>

        {!showEmailForm ? (
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
                onClick={() => onSocialLogin?.("google")}
                disabled={loading}
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
                className="btn-social btn-social-discord"
                onClick={() => onSocialLogin?.("discord")}
                disabled={loading}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.094 13.094 0 0 1-1.873-.894.077.077 0 0 1-.008-.128c.126-.093.252-.19.372-.287a.075.075 0 0 1 .077-.011c3.92 1.793 8.18 1.793 12.061 0a.073.073 0 0 1 .078.009c.12.099.246.195.373.289a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.156 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.156-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.156 2.418z"/>
                </svg>
                <span>Sign in with Discord</span>
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
