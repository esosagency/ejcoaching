# EJ Coaching client-access contracts

Existing project: /home/ubuntu/ejcoaching. Keep fr-CA premium UI, routes, true Manus OAuth and current admin allowlist. No browser/Git/DB writes from delegated implementations. Parent owns OAuth, catalog restrictions/media transforms, encryption pipeline and storage, app route composition and deployment.

## Backend ownership

Backend agent owns drizzle/schema.ts and generated migration/meta; shared/clientAccess.ts; server/clientAccess.ts; server/clientRouter.ts; isolated client permission tests. Do not modify other existing modules. Add these schema exports:

- coachingClients: id varchar64 PK, email varchar320 unique normalized immutable, name varchar180 notNull (may empty), status enum active/revoked default active, revision int default1, createdBy int FK users.id restrict, createdAt/updatedAt datetime.
- clientCourseAccess: clientId varchar64 FK coachingClients.id, courseId varchar128 FK contentCourses.id, composite PK, createdAt datetime. Replacing assignment rows transactionally is allowed; do not delete client accounts or courses.
- privateMedia: objectKey varchar512 PK, id varchar64 unique/notNull, keyBase64 varchar44 notNull, nonceBase64 varchar16 notNull, plainSize int notNull, chunkSize int notNull, contentType varchar128 notNull, layout enum single/parts notNull, status enum pending/ready default pending, createdAt/updatedAt datetime. This table is private server metadata, NEVER put keys in management/access/course DTOs. Parent implements the crypto functions against it.

AccessInfo in shared/clientAccess.ts: {authenticated:boolean,allowed:boolean,isAdmin:boolean,reason?:'signed_out'|'unapproved'|'revoked',user?:{id:number,name:string,email:string},clientId?:string}. Do not include other clients or raw keys. Functions:
- getAccessForUser(user: User|null): Promise<AccessInfo>. Admin early allowed; null/cron-style user denied; active approval by current normalized OAuth email allowed, revoked/unapproved false. No auto approval.
- getAssignedCourseIds(user: User): Promise<string[]> (admin all non-archived published IDs; clients approved assignments to published active courses, otherwise []).
- canAccessCourse(user: User|null, courseId:string): Promise<boolean> (owner/admin may active draft; client requires active approval+assignment+published active course).

clientRouter exports const clientRouter with:
- me public query => AccessInfo from ctx.user.
- adminList admin query => client rows {id,email,name,status,revision,courseIds:string[],createdAt:string,updatedAt:string}[].
- approve admin mutation {email,name,courseIds:string[]} => {id}; email normalized/valid, no duplicate overwrite or approving an admin address. Validate assignment course IDs (non-archived; may assign draft for future release), explicit selections only.
- update admin mutation {id,revision,name,courseIds:string[]} => {id}; email immutable.
- setStatus admin mutation {id,revision,status:'active'|'revoked'} => {id}; status authoritative on next access, preserve assignment rows for reactivation.

All mutations strict schemas, admin rights, optimistic revision, French useful errors. No fake seeded approvals or outgoing email. Route registered by parent as clients: clientRouter. Migration new 0003 must only add client tables/privateMedia and indexes, not alter existing course/user/video data.

## Frontend ownership

UI agent owns client/src/contexts/AccessContext.tsx; client/src/components/ClientGate.tsx; client/src/pages/admin/AdminClients.tsx plus its CSS if needed; shared/clientAccess.ts only if backend has not written it—prefer import type contracts from eventual backend file without overwriting. Do not modify App.tsx, shell, catalog/progress/lesson or OAuth. Parent integrates them.

AccessProvider/ useAccess uses trpc.clients.me, exposes {access:AccessInfo|undefined,loading:boolean,error:{message:string}|null,retry:()=>void}. ClientGate shows signed-out signin (startLogin/getLoginUrl existing const helper), denied/revoked message and logout/other-account control; only renders children when access.allowed. Provider must not cache another identity's access after logout; documented invalidate/reset handling for parent. Keep true auth; no fallback demo member.

AdminClients defaults exported page wrapped in existing AdminGate. List/search approved and revoked clients; add email/name, assign available courses via trpc.content.adminList; edit name and assignments without email changes; revoke/reactivate with confirmation; handle conflicts/refetch while preserving errors. State clearly: clients use existing Manus sign-in with that email; no automatic email invitations. Do not add any actual client during development. Parent adds /admin/clients to App, shell, route manifest.
