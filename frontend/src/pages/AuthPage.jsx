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
        {notice ? <span className="badge auth-notice">{notice}</span> : null}
      </form>
    </div>
  );
}
