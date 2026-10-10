function getTenantKey() {
  try {
    const raw = localStorage.getItem("smrt-user");
    if (raw) {
      const u = JSON.parse(raw);
      const key = u.company_id || u.tenant_id || u.company_code || u.tenant || u.email;
      if (key) return String(key);
    }
  } catch {}
  return "default";
}

function getStorageKey() {
  const tenantKey = getTenantKey();
  return `iva_local_leave_records_${tenantKey}`;
}

/**
 * Get all stored leave records from localStorage.
 */
export function getLocalLeaves() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save or update a leave record in localStorage.
 */
export function saveLocalLeave(record) {
  try {
    const list = getLocalLeaves();
    const localId = record._localId || record.id || `local_${Date.now()}`;
    const cleanRecord = {
      ...record,
      _localId: localId,
      id: record.id || localId,
    };
    const updated = [cleanRecord, ...list.filter((r) => r.id !== cleanRecord.id && r._localId !== cleanRecord._localId)];
    localStorage.setItem(getStorageKey(), JSON.stringify(updated));
    window.dispatchEvent(new Event("leave-updated"));
    return cleanRecord;
  } catch {
    return record;
  }
}

/**
 * Update the approval status of a leave request in localStorage.
 */
export function updateLocalLeaveStatus(id, newStatus, updatedBy = "Admin") {
  try {
    const list = getLocalLeaves();
    let found = false;
    const updated = list.map((r) => {
      if (r.id === id || r._localId === id || String(r.id) === String(id)) {
        found = true;
        return {
          ...r,
          status: newStatus,
          updated_by: updatedBy,
          updated_at: new Date().toISOString(),
        };
      }
      return r;
    });

    if (!found) {
      updated.unshift({
        id,
        _localId: id,
        status: newStatus,
        updated_by: updatedBy,
        updated_at: new Date().toISOString(),
      });
    }

    localStorage.setItem(getStorageKey(), JSON.stringify(updated));
    window.dispatchEvent(new Event("leave-updated"));
  } catch {
    // ignore
  }
}

/**
 * Merge server leave records with locally saved records and overrides.
 */
export function mergeLeavesWithLocal(serverRecords = []) {
  const local = getLocalLeaves();
  if (!local.length) return serverRecords;

  const result = [...serverRecords];

  for (const loc of local) {
    const idx = result.findIndex((s) => {
      if (s.id && loc.id && String(s.id) === String(loc.id)) return true;
      if (
        String(s.employee_name || s.employee || "").trim().toLowerCase() === String(loc.employee_name || "").trim().toLowerCase() &&
        String(s.leave_type || "").trim().toLowerCase() === String(loc.leave_type || "").trim().toLowerCase() &&
        String(s.start_date || "").slice(0, 10) === String(loc.start_date || "").slice(0, 10) &&
        String(s.end_date || "").slice(0, 10) === String(loc.end_date || "").slice(0, 10)
      ) {
        return true;
      }
      return false;
    });

    if (idx >= 0) {
      result[idx] = {
        ...result[idx],
        ...loc,
        status: loc.status || result[idx].status,
        updated_by: loc.updated_by || result[idx].updated_by,
      };
    } else if (loc._localId || String(loc.id || "").startsWith("local_")) {
      result.unshift(loc);
    }
  }

  return result;
}

