(async () => {
  const technicalId = "REQPv6QEJAm4MKdgj2ZfL";
  const initialRevision = 12;
  async function api(name, input, mutation = false) {
    const path = `/api/trpc/${name}`;
    const response = await fetch(mutation ? path : `${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`, {
      method: mutation ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      headers: mutation ? { "Content-Type": "application/json" } : undefined,
      body: mutation ? JSON.stringify({ json: input ?? null }) : undefined,
    });
    const body = await response.json();
    return { status: response.status, data: body.result?.data?.json, errorCode: body.error?.json?.data?.code };
  }
  function requireSuccess(result, label) {
    if (result.status !== 200 || result.data === undefined) throw new Error(`${label} failed: HTTP ${result.status}`);
    return result.data;
  }
  const owner = requireSuccess(await api("auth.me"), "Owner identity");
  if (owner?.role !== "admin") return { testNotRun: true, reason: "Real administrator session required" };
  const list = requireSuccess(await api("clients.adminList"), "Technical-client lookup");
  const technical = list.find(row => row.id === technicalId);
  if (!technical || technical.name !== "Client test EJ" || technical.status !== "revoked" || technical.revision !== initialRevision) {
    return { testNotRun: true, reason: "Technical client changed; preserving it" };
  }
  const course = requireSuccess(await api("content.adminGet", { id: "nutrition" }), "Assigned course");
  const other = requireSuccess(await api("content.adminGet", { id: "training" }), "Unassigned course");
  if (course.status !== "published" || course.lessons.length < 3 || !technical.courseIds.includes(course.id)) {
    return { testNotRun: true, reason: "Technical course requirements changed" };
  }
  const first = course.lessons[0].id;
  const second = course.lessons[1].id;
  const absent = course.lessons[2].id;
  const accountKey = `client_${technicalId}`;
  const issued = requireSuccess(await api("clients.issueCode", { id: technicalId, revision: initialRevision }, true), "Issue temporary code");
  const activated = requireSuccess(await api("clients.setStatus", { id: technicalId, revision: issued.revision, status: "active" }, true), "Activate technical access");
  // Plain codes remain only in this function's memory, never in logs, localStorage or URLs.
  const firstCode = issued.code;
  requireSuccess(await api("clients.login", { code: firstCode }, true), "First real code session");
  const empty = requireSuccess(await api("learning.snapshot", { accountKey }), "Initial learning snapshot");
  if (empty.records.length !== 0) throw new Error("Technical learning rows are not empty; do not clean pre-existing data.");
  const imported = requireSuccess(await api("learning.importLocal", {
    accountKey, completedIds: [first], savedIds: [first],
    notes: [{ lessonId: first, note: "Legacy technical sync note" }], lastLessonId: first,
  }, true), "Conservative local import");
  const importedNote = imported.records.find(row => row.lessonId === first);
  if (importedNote?.noteRevision !== 1) throw new Error("Imported note must have revision 1");
  requireSuccess(await api("learning.setCompleted", { accountKey, lessonId: first, completed: false }, true), "Explicit false completion");
  requireSuccess(await api("learning.setCompleted", { accountKey, lessonId: first, completed: true }, true), "Completion save");
  requireSuccess(await api("learning.setSaved", { accountKey, lessonId: first, saved: true }, true), "Saved-lesson state");
  requireSuccess(await api("learning.saveNote", { accountKey, lessonId: first, note: "Technical database-sync check", expectedRevision: 1 }, true), "Note save");
  requireSuccess(await api("learning.visit", { accountKey, lessonId: first }, true), "First visit");
  requireSuccess(await api("learning.visit", { accountKey, lessonId: second }, true), "Latest visit");
  requireSuccess(await api("clients.logout", undefined, true), "End first session");
  requireSuccess(await api("clients.login", { code: firstCode }, true), "Second independent code session");
  const shared = requireSuccess(await api("learning.snapshot", { accountKey }), "Database-backed second-session snapshot");
  const record = shared.records.find(row => row.lessonId === first);
  if (!record?.completed || !record.saved || record.note !== "Technical database-sync check" || shared.lastLessonId !== second) {
    throw new Error("Second session did not load authoritative progress");
  }
  const conflict = await api("learning.saveNote", { accountKey, lessonId: first, note: "Stale technical draft", expectedRevision: 1 }, true);
  const denied = await api("learning.setCompleted", { accountKey, lessonId: other.lessons[0].id, completed: true }, true);
  const staleAccount = await api("learning.snapshot", { accountKey: "client_other" });
  const deniedAdmin = await api("clients.adminList");
  if (conflict.status !== 409 || denied.status !== 403 || staleAccount.status !== 403 || deniedAdmin.status !== 403) {
    throw new Error("Conflict or authorization guard did not reject the request");
  }
  requireSuccess(await api("clients.logout", undefined, true), "Return to genuine owner");
  const current = requireSuccess(await api("clients.adminList"), "Current technical revision").find(row => row.id === technicalId);
  const replacement = requireSuccess(await api("clients.issueCode", { id: technicalId, revision: current.revision }, true), "Replace temporary code");
  const oldCode = await api("clients.login", { code: firstCode }, true);
  if (oldCode.status !== 401) throw new Error("Replaced code still accepted");
  requireSuccess(await api("clients.login", { code: replacement.code }, true), "New-code real session");
  const retained = requireSuccess(await api("learning.snapshot", { accountKey }), "Progress after code replacement");
  const retainedRecord = retained.records.find(row => row.lessonId === first);
  if (!retainedRecord?.completed || !retainedRecord.saved || retainedRecord.note !== "Technical database-sync check" || retained.lastLessonId !== second) {
    throw new Error("Code replacement erased progress");
  }
  const reset = requireSuccess(await api("learning.reset", { accountKey }, true), "Reset technical progress only");
  const resetRecord = reset.records.find(row => row.lessonId === first);
  if (resetRecord?.completed || resetRecord?.saved || reset.lastLessonId || resetRecord.note !== "Technical database-sync check") {
    throw new Error("Reset did not preserve notes while clearing progress");
  }
  const lateLegacy = requireSuccess(await api("learning.importLocal", {
    accountKey, completedIds: [absent], savedIds: [absent], notes: [], lastLessonId: absent,
  }, true), "Old-device import after reset");
  if (lateLegacy.records.some(row => row.lessonId === absent && (row.completed || row.saved)) || lateLegacy.lastLessonId) {
    throw new Error("An old device resurrected reset progress");
  }
  requireSuccess(await api("clients.logout", undefined, true), "End final technical session");
  const restoredOwner = requireSuccess(await api("auth.me"), "Owner restored");
  return {
    independentCodeSessionsLoadSameProgress: true,
    replacedCodeRejected: true,
    replacementCodePreservesProgress: true,
    optimisticNoteConflictRejected: true,
    unassignedLessonDenied: true,
    staleAccountDenied: true,
    clientAdminAccessDenied: true,
    resetRetainsNotes: true,
    oldDeviceCannotResurrectReset: true,
    finalTechnicalRevision: replacement.revision,
    genuineOwnerRestored: restoredOwner.role === "admin",
  };
})()
