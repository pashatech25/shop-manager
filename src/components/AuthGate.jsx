import React from "react";
import {useAuth} from "../context/AuthContext";

export default function AuthGate({children}){
  const {session,loading} = useAuth();
  if(loading) return <div className="shadow-box">Loading session…</div>;
  if(!session){
    // not signed in
    window.location.replace("/login");
    return null;
  }
  return children;
}
