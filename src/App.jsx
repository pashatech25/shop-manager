import React from "react";
import {BrowserRouter, Routes, Route, Navigate} from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import Reports from "./pages/Reports.jsx";
import Quotes from "./pages/Quotes.jsx";
import Jobs from "./pages/Jobs.jsx";
import Settings from "./pages/Settings.jsx";
import Materials from "./pages/Materials.jsx";
import Vendors from "./pages/Vendors.jsx";
import Customers from "./pages/Customers.jsx";
import AddOns from "./pages/Addons.jsx";
import Invoices from "./pages/Invoices.jsx";
import Login from "./pages/Login.jsx";
import Shop from "./pages/Shop.jsx";
import Inventory from "./pages/Inventory.jsx";
import PurchaseOrders from "./pages/PurchaseOrders.jsx";

import NotificationCenter from "./features/notifications/Center.jsx";
import AuthGate from "./components/AuthGate.jsx";
import Layout from "./components/Layout.jsx";

export default function App(){
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login/>}/>
        <Route
          path="/*"
          element={
            <AuthGate>
              <Layout>
                <NotificationCenter/>
                <Routes>
                  <Route index element={<Navigate to="/dashboard" replace/>}/>
                  <Route path="dashboard" element={<Dashboard/>}/>
                  <Route path="quotes" element={<Quotes/>}/>
<Route path="jobs/*" element={<Jobs/>}/>
                  <Route path="materials" element={<Materials/>}/>
                  <Route path="inventory" element={<Inventory/>}/>
<Route path="purchase-orders" element={<PurchaseOrders/>}/>
                  <Route path="vendors" element={<Vendors/>}/>
                  <Route path="customers" element={<Customers/>}/>
                  <Route path="addons" element={<AddOns/>}/>
                  <Route path="invoices" element={<Invoices/>}/>
                  <Route path="reports" element={<Reports/>}/>
                  <Route path="settings" element={<Settings/>}/>
                  <Route path="shop" element={<Shop/>}/>
                  <Route path="*" element={<div className="container">Not Found</div>} />
                </Routes>
              </Layout>
            </AuthGate>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
