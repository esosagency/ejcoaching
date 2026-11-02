# Persistent client learning contract

Use the existing code-authenticated coachingClients.id. No new identity, login requirement, code secret in progress rows, fake admin or application-auth bypass. Application and technical briefs are English; UI remains French Canadian. Existing plan.md and TODO.md describe approved outcomes.

## Router methods

Namespace `learning` in server/routers.ts (parent integrates registration). All inputs carry accountKey (client_<id>) only to reject stale browser/account requests. Ownership MUST always come from the authenticated ctx.client and current active/session-code-version/course assignments, never from the submitted key. Real OAuth admins without a client principal cannot call these methods; their learning practice remains local.

- snapshot query({accountKey}) -> LearningSnapshot from shared/learning.ts.
- setCompleted mutation({accountKey,lessonId,completed}) -> ClientLearningRecord.
- setSaved mutation({accountKey,lessonId,saved}) -> ClientLearningRecord.
- saveNote mutation({accountKey,lessonId,note,expectedRevision}) -> ClientLearningRecord. Revision mismatch TRPC CONFLICT. Only this method/import changes noteRevision; visits/completion/saved actions cannot rewrite notes.
- visit mutation({accountKey,lessonId}) -> ClientLearningRecord with server lastViewedAt. Snapshot lastLessonId is latest lastViewedAt among assigned published non-archived lessons, or null.
- importLocal mutation(LegacyLearningImport) -> LearningSnapshot. Conservative/idempotent legacy import: set completion/saved only where the respective server field has never been deliberately set (nullable completedSetAt/savedSetAt); import note only if noteRevision=0 and untouched; import last lesson only if no server last view exists. Silently filter legacy items not currently assigned/visible; never expose them or revive newer false/completed/cleared-note state. Bounds are shared constants. Client browser records a per-account migration marker only after successful import.
- reset mutation({accountKey}) -> LearningSnapshot. Explicit user-confirmed reset of completion/saved/last-viewed for this client across devices, retaining notes and record history, setting field timestamps so legacy imports cannot resurrect reset values. No deletion of client identity, courses or notes.

## Backend owner

Own drizzle/schema.ts, additive migration 0005 and generated meta journal/snapshot, server/learningDb.ts, server/learningRouter.ts and isolated backend tests. Do not migrate/write shared DB or use browser. No other files. Table clientLessonProgress keyed by (clientId,lessonId) with FK restrict, completed/saved defaultfalse, completedSetAt/savedSetAt nullable, note text(defaultempty), noteRevision default0, lastViewedAt nullable, createdAt/updatedAt and helpful lookup index. Independent field-specific updates; no full stale snapshot replacement. Shared DTOs exist. Router validates lengths/revisions and stable account keys. DB guards current active code client and published assigned lesson even though app context is authenticated.

## Frontend owner

Own client/src/contexts/LearningContext.tsx, client/src/pages/Lesson.tsx, client/src/components/LearningShell.tsx and appropriate existing learning-page copy (Home, CourseDetail, MyLearning, CourseCard), plus new helpers/components/tests/CSS needed. Do not edit schema/server/shared files, App.tsx or useAuth.ts (parent owns cache integration). Preserve French premium layout and personal-code login. Existing provider is already inside Access/Catalog and wraps shell. For code clients, query snapshot by accountKey; explicit booleans/partial fields; refresh foreground every ~15 seconds, on focus/reconnect and successful actions. Provide loading/saving/error/retry feedback, do not claim offline saves. Keep typed note draft until acknowledged and preserve on API errors/CONFLICT; show explicit keep-my-text/load-server-version recovery instead of silent overwrite. Debounce auto-save (e.g. 800ms), guard stale account/lesson, and flush or retain pending draft on lesson navigation. Existing local per-account data import once conservatively, owner legacy practice preserved and preview read-only.

Suggested useLearning additions: persistence='client-cloud'|'admin-local'|'preview', syncStatus, syncError, retrySync; note record/revision getter plus async saveNote; controls can expose pending action state. Keep completed/saved/lastLesson/courseProgress/toggleComplete/toggleSaved/visitLesson/resetProgress compatible with current consumers. Reset confirmation explicitly mentions all devices and retained notes. Notes max 10,000 chars. New pure helper tests may use isolated fixtures without real API/storage writes. No new dependencies required.

## Parent owner

Register router, clear learning cache on logout, apply reviewed migration, run type/tests/build and real technical-session check if legitimate owner access remains available, review integration, and save canonical checkpoint. Do not create fake users or leave technical progress mixed into real client data. No publication/hosting change.
