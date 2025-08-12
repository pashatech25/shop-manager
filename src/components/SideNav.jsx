import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

export default function SideNav() {
  const [collapsed, setCollapsed] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
  }, [collapsed]);

  const isActive = (to) => pathname.startsWith(to);

  const menuItems = [
    { to: "/dashboard", icon: "fa-solid fa-gauge-high", label: "Dashboard" },
    { to: "/quotes", icon: "fa-solid fa-file-pen", label: "Quotes" },
    { to: "/jobs", icon: "fa-solid fa-briefcase", label: "Jobs" },
    { to: "/invoices", icon: "fa-solid fa-file-invoice-dollar", label: "Invoices" },
    { to: "/materials", icon: "fa-solid fa-boxes-stacked", label: "Materials" },
    { to: "/vendors", icon: "fa-solid fa-truck-field", label: "Vendors" },
    { to: "/inventory", icon: "fa-solid fa-box-open", label: "Inventory" },
    { to: "/purchase-orders", icon: "fa-solid fa-receipt", label: "Purchase Orders" },
    { to: "/customers", icon: "fa-solid fa-user-group", label: "Customers" },
    { to: "/addons", icon: "fa-solid fa-puzzle-piece", label: "Add-ons" },
    { to: "/shop", icon: "fa-solid fa-screwdriver-wrench", label: "Shop" },
    { to: "/reports", icon: "fa-solid fa-chart-line", label: "Reports" },
    { to: "/settings", icon: "fa-solid fa-gear", label: "Settings" }
  ];

  return (
    <>
    

      <aside id="sidebar-container">
        <nav className={`floating-nav ${collapsed ? "collapsed" : ""}`}>
          <button
            className="collapse-toggle"
            title={collapsed ? "Expand" : "Collapse"}
            onClick={() => setCollapsed((v) => !v)}
          >
            <i className="fa-solid fa-angles-left" />
          </button>

          <div className="logo-section">
            <div className="logo-title">Shop Manager</div>
            <div className="logo-subtitle">Multi-tenant</div>
          </div>

          {menuItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`nav-item ${isActive(item.to) ? "active" : ""}`}
            >
              <div className="nav-icon">
                <i className={item.icon} />
              </div>
              <span className="nav-text">{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}