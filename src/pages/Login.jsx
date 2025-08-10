import React, {useState} from "react";
import {supabase} from "../lib/supabaseClient";

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
    <div className="container" style={{maxWidth:480, margin:"40px auto"}}>
      <h2 className="mb-3">Sign in</h2>
      <div className="btn-group mb-3" role="group">
        <button className={`btn btn-${mode==="password"?"primary":"outline-primary"}`} onClick={()=>setMode("password")}>Password</button>
        <button className={`btn btn-${mode==="magic"?"primary":"outline-primary"}`} onClick={()=>setMode("magic")}>Magic Link</button>
      </div>

      <form onSubmit={onSubmit} className="form-card">
        <label className="form-label">Email</label>
        <input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required />
        {mode==="password" && (
          <>
            <label className="form-label">Password</label>
            <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required />
          </>
        )}
        <button className="btn btn-primary mt-3" disabled={loading}>
          {loading ? "Working…" : (mode==="magic" ? "Send Magic Link" : "Sign In")}
        </button>
        {msg && <div className="alert alert-success mt-3">{msg}</div>}
        {err && <div className="alert alert-danger mt-3">{err}</div>}
      </form>
    </div>
  );
}
