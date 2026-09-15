"use client";
import { useState } from "react";
export function LogoutButton(){const [busy,setBusy]=useState(false);async function logout(){setBusy(true);await fetch("/api/auth/logout",{method:"POST"});window.location.href="/login";}return <button className="btn" disabled={busy} onClick={logout}>{busy?"…":"Déconnexion"}</button>}
