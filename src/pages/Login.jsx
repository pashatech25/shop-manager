import React, {useState} from "react";
import {supabase} from "../lib/supabaseClient";
import "./Login.css";

export default function Login(){
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [mode,setMode] = useState("password"); // "password" | "magic"
  const [msg,setMsg] = useState("");
  const [err,setErr] = useState("");
  const [loading,setLoading] = useState(false);

  const onSubmit=async(e)=>{
    e.preventDefault();
    setErr(""); setMsg(""); setLoading(true);
    try{
      if(mode==="magic"){
        const {error} = await supabase.auth.signInWithOtp({email, options:{emailRedirectTo: window.location.origin}});
        if(error) throw error;
        setMsg("Check your email for the magic link.");
      }else{
        const {error} = await supabase.auth.signInWithPassword({email, password});
        if(error) throw error;
        setMsg("Signed in!");
        setTimeout(()=>{ window.location.href="/"; }, 400);
      }
    }catch(ex){ setErr(ex.message||"Login failed"); }
    finally{ setLoading(false); }
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-dot" />
          <span className="brand-name">Shop Manager</span>
        </div>

        <h2 className="login-title">Sign in</h2>

        <div className="segmented mb-3" role="tablist" aria-label="Sign-in method">
          <button className={`segmented-btn ${mode==="password"?"active":""}`} onClick={()=>setMode("password")} type="button">Password</button>
          <button className={`segmented-btn ${mode==="magic"?"active":""}`} onClick={()=>setMode("magic")} type="button">Magic Link</button>
        </div>

        <form onSubmit={onSubmit} className="form-card">
          <label className="form-label">Email</label>
          <input className="input" type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required />

          {mode==="password" && (
            <>
              <label className="form-label">Password</label>
              <input className="input" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required />
            </>
          )}

          <button className="primary-btn mt-3" disabled={loading}>
            {loading ? "Working…" : (mode==="magic" ? "Send Magic Link" : "Sign In")}
          </button>

          {msg && <div className="alert success mt-3" role="status">{msg}</div>}
          {err && <div className="alert danger mt-3" role="alert">{err}</div>}
        </form>

        <p className="legal">By continuing, you agree to the Terms & Privacy Policy.</p>
      </div>
    </div>
  );
}
