"use client";

import { useEffect, useState } from "react";
import {
  getAdminModeEnabled,
  subscribeAdminModeEnabled,
} from "@/lib/adminMode";

export default function AdminNavLabel() {
  const [enabled, setEnabled] = useState(() => getAdminModeEnabled());

  useEffect(() => {
    return subscribeAdminModeEnabled(setEnabled);
  }, []);

  return (
    <span className="flex items-center gap-2">
      <span>Admin</span>
      {!enabled ? (
        <span className="text-xs text-muted-foreground">(disabled)</span>
      ) : null}
    </span>
  );
}
