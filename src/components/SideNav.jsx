import React, {useEffect, useState} from "react";
import {Link, useLocation} from "react-router-dom";

export default function SideNav(){
  const [collapsed,setCollapsed] = useState(false);
  const {pathname} = useLocation();

  useEffect(()=>{
    document.body.classList.toggle("sidebar-collapsed", collapsed);
  },[collapsed]);

  const isActive=(to)=> pathname.startsWith(to);

  return (
    <aside id="sidebar-container">
      <nav className={`side-nav ${collapsed ? "collapsed" : ""}`}>
        <button
          className="collapse-toggle"
          title={collapsed ? "Expand" : "Collapse"}
          onClick={()=>setCollapsed((v)=>!v)}
        >
          <i className="fa-solid fa-angles-left" />
        </button>

        <div className="logo">
          <div>Shop Manager</div>
          <small>Multi-tenant</small>
        </div>

        <Link to="/dashboard" className={`nav-link ${isActive("/dashboard")?"active":""}`}>
          <i className="fa-solid fa-gauge-high" /><span>Dashboard</span>
        </Link>

        <Link to="/quotes" className={`nav-link ${isActive("/quotes")?"active":""}`}>
          <i className="fa-solid fa-file-pen" /><span>Quotes</span>
        </Link>

        <Link to="/jobs" className={`nav-link ${isActive("/jobs")?"active":""}`}>
          <i className="fa-solid fa-briefcase" /><span>Jobs</span>
        </Link>

        <Link to="/invoices" className={`nav-link ${isActive("/invoices")?"active":""}`}>
          <i className="fa-solid fa-file-invoice-dollar" /><span>Invoices</span>
        </Link>

        <Link to="/materials" className={`nav-link ${isActive("/materials")?"active":""}`}>
          <i className="fa-solid fa-boxes-stacked" /><span>Materials</span>
        </Link>

        <Link to="/vendors" className={`nav-link ${isActive("/vendors")?"active":""}`}>
          <i className="fa-solid fa-truck-field" /><span>Vendors</span>
        </Link>
<Link to="/inventory" className={`nav-link ${isActive("/inventory")?"active":""}`}>
  <i className="fa-solid fa-box-open"/><span>Inventory</span>
</Link>
<Link to="/purchase-orders" className={`nav-link ${isActive("/purchase-orders")?"active":""}`}>
  <i className="fa-solid fa-receipt"/><span>Purchase Orders</span>
</Link>


        <Link to="/customers" className={`nav-link ${isActive("/customers")?"active":""}`}>
          <i className="fa-solid fa-user-group" /><span>Customers</span>
        </Link>

        <Link to="/addons" className={`nav-link ${isActive("/addons")?"active":""}`}>
          <i className="fa-solid fa-puzzle-piece" /><span>Add-ons</span>
        </Link>

        <Link to="/shop" className={`nav-link ${isActive("/shop")?"active":""}`}>
          <i className="fa-solid fa-screwdriver-wrench" /><span>Shop</span>
        </Link>

        <Link to="/reports" className={`nav-link ${isActive("/reports")?"active":""}`}>
          <i className="fa-solid fa-chart-line" /><span>Reports</span>
        </Link>

        <Link to="/settings" className={`nav-link ${isActive("/settings")?"active":""}`}>
          <i className="fa-solid fa-gear" /><span>Settings</span>
        </Link>
      </nav>
    </aside>
  );
}
