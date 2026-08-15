import { useState } from "react";
import {
  loginWithPassword,
  registerWithPassword,
  resendRegistrationCode,
  verifyRegistration,
} from "./services/authService.js";

function readableError(error, fallback) {
  if (error?.status === 401) return "That email and password do not match.";
  if (error?.status === 403) return "Please verify your email before signing in.";
  return error?.message || fallback;
}

export function AuthScreen({ initialError = "", onAuthenticated }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setNotice("");
    setOtpCode("");
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    try {
      if (mode === "login") {
        onAuthenticated(await loginWithPassword(email.trim(), password));
      } else if (mode === "signup") {
        await registerWithPassword(email.trim(), password);
        setMode("verify");
        setNotice("We sent a verification code to your email.");
      } else {
        await verifyRegistration(email.trim(), otpCode.trim());
        onAuthenticated(await loginWithPassword(email.trim(), password));
      }
    } catch (requestError) {
      setError(readableError(requestError, "Authentication could not be completed."));
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    setBusy(true);
    setError("");
    try {
      await resendRegistrationCode(email.trim());
      setNotice("A new verification code is on its way.");
    } catch (requestError) {
      setError(readableError(requestError, "The verification code could not be resent."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="auth-eyebrow">Armoire</p>
        <h1 id="auth-title">Your wardrobe already exists inside your photos.</h1>
        <p className="auth-intro">Sign in to open your private wardrobe.</p>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={mode === "verify" || busy}
              required
            />
          </label>

          {mode !== "verify" && (
            <label>
              <span>Password</span>
              <input
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                disabled={busy}
                required
              />
            </label>
          )}

          {mode === "verify" && (
            <label>
              <span>Verification code</span>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value)}
                disabled={busy}
                required
                autoFocus
              />
            </label>
          )}

          {error && <p className="auth-message error" role="alert">{error}</p>}
          {notice && <p className="auth-message" role="status">{notice}</p>}

          <button className="auth-submit" type="submit" disabled={busy}>
            {busy ? "Please wait" : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Verify and enter"}
          </button>
        </form>

        <div className="auth-options">
          {mode === "login" && <button type="button" onClick={() => switchMode("signup")}>Create an account</button>}
          {mode === "signup" && <button type="button" onClick={() => switchMode("login")}>Already have an account?</button>}
          {mode === "verify" && (
            <>
              <button type="button" onClick={resendCode} disabled={busy}>Resend code</button>
              <button type="button" onClick={() => switchMode("signup")} disabled={busy}>Use another email</button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
