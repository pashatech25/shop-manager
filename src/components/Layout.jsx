import React from "react";
import SideNav from "./SideNav.jsx";
import {useAuth} from "../context/AuthContext.jsx";
import {supabase} from "../lib/supabaseClient";

/** Top bar = mobile header (shown only ≤768px via CSS) */
function TopBar(){
  const {session} = useAuth();
  const email = session?.user?.email || "—";
  return (
    <nav className="mobile-menu" aria-label="Mobile top bar">
      <div className="mobile-menu-header">
        <button
          className="hamburger-btn"
          aria-label="Toggle Menu"
          onClick={()=>{ const el=document.getElementById("mobile-slide"); if(el){ el.classList.toggle("open"); } }}
        >
          <i className="fa-solid fa-bars"/>
        </button>
        <div className="mobile-menu-buttons">
          <span className="btn btn-dark">{email}</span>
          <button
            className="btn btn-outline-light"
            onClick={()=>supabase.auth.signOut().then(()=>location.href="/login")}
          >
            Logout
          </button>
        </div>
      </div>
    </nav>
  );
}

/** Slide-in mobile nav */
function MobileSlideNav(){
  return (
    <div id="mobile-slide" className="mobile-slide-nav" aria-hidden="true">
      <div className="mobile-nav-content">
        <button
          className="mobile-close-btn"
          aria-label="Close Menu"
          onClick={()=>document.getElementById("mobile-slide")?.classList.remove("open")}
        >
          <i className="fa-solid fa-xmark"/>
        </button>
        <div className="logo">Shop Manager</div>
        <a className="nav-link" href="/dashboard"><i className="fa-solid fa-gauge-high"/><span>Dashboard</span></a>
        <a className="nav-link" href="/quotes"><i className="fa-solid fa-file-pen"/><span>Quotes</span></a>
        <a className="nav-link" href="/jobs"><i className="fa-solid fa-briefcase"/><span>Jobs</span></a>
        <a className="nav-link" href="/invoices"><i className="fa-solid fa-file-invoice-dollar"/><span>Invoices</span></a>
        <a className="nav-link" href="/materials"><i className="fa-solid fa-boxes-stacked"/><span>Materials</span></a>
        <a className="nav-link" href="/vendors"><i className="fa-solid fa-truck-field"/><span>Vendors</span></a>
        <a className="nav-link" href="/customers"><i className="fa-solid fa-user-group"/><span>Customers</span></a>
        <a className="nav-link" href="/addons"><i className="fa-solid fa-puzzle-piece"/><span>Add-ons</span></a>
        <a className="nav-link" href="/shop"><i className="fa-solid fa-screwdriver-wrench"/><span>Shop</span></a>
        <a className="nav-link" href="/reports"><i className="fa-solid fa-chart-line"/><span>Reports</span></a>
        <a className="nav-link" href="/settings"><i className="fa-solid fa-gear"/><span>Settings</span></a>
      </div>
    </div>
  );
}

export default function Layout({children}){
  return (
    <>
      {/* Desktop sidebar (hidden on mobile via CSS) */}
      <SideNav/>
      {/* Mobile top bar + slide menu (visible on mobile via CSS) */}
      <TopBar/>
      <MobileSlideNav/>
      {/* Main content wrapper — add .content to pick up your container styles */}
      <div id="app-container" className="content">
        {children}
      </div>
    </>
  );
}
