# Native phone video implementation contract

Project: /home/ubuntu/ejcoaching. Interface fr-CA. Preserve existing course IDs, role checks and data. No browser access by implementation agents. Source limits 1 GiB / 1800 seconds / 4K-class; output H.264 yuv420p AAC stereo (when audio exists), fast-start MP4 <=1 GiB, <=30fps, bounding box 1920x1080 landscape /1080x1920 portrait; generate JPEG poster. Source formats .mov .mp4 .m4v .webm .3gp .3g2. Common HEVC HDR iPhone files supported; no ProRes RAW promise.

## Ownership

- Media agent ONLY: server/video/mediaProcessor.ts, server/video/mediaStorage.ts, media-specific tests. No schema/router/UI/shared-file changes.
- Backend agent: shared/phoneVideo.ts, shared/content.ts (only video optional fields), drizzle schema/migration/meta, server/video/videoDb.ts, server/video/videoWorker.ts, server/video/videoRouter.ts, server/contentDb.ts, server/contentValidation.ts and server/contentRouter.ts guard paths, backend-specific tests. Do not edit server/routers.ts, server/_core/index.ts, Dockerfile, UI or media-agent files.
- UI agent: client/src/components/admin/PhoneVideoUpload.tsx + PhoneVideoUpload.css, client/src/pages/admin/AdminEditor.tsx. No backend/shared schema edits. Read shared DTO/contracts as they become available.
- Parent: server/routers.ts and server/_core/index.ts integration, Dockerfile, production resource preparation, client/src/pages/Lesson.tsx player poster/pending UI, TODO/plan and final checks. Parent applies migrations after inspection; agents do not mutate shared DB.

## Media agent exports

`convertPhoneVideo({inputPath, outputDirectory, signal?, onProgress?}): Promise<{videoPath:string;posterPath:string;durationSeconds:number;width:number;height:number;hasAudio:boolean}>`.
`probePhoneVideo(inputPath, signal?): Promise<...>` may be exported for tests.
`downloadStoredVideo(objectKey, destinationPath, expectedSize, signal?): Promise<void>` streams signed storage GET with exact size and <=1 GiB checks; no browser-provided source URLs and no signed URL logging.
`uploadStoredFile(objectKey, filePath, contentType, signal?): Promise<{key:string;url:string;size:number}>` streams presigned PUT; retain exact random output key supplied by worker (no additional suffix).
`prepareStoredPut(objectKey):Promise<string>` retrieves a PUT URL for protected video.prepare.
`verifyStoredSource({objectKey,size,contentType}):Promise<void>` HEAD checks actual size/type, fails closed. Environment uses existing ENV.forgeApiUrl/forgeApiKey aliases backed by MANUS_API_URL/MANUS_API_KEY. Protocol/timeout/file validation and abort cleanup required. FFmpeg must use argv, never shell interpolation; only local files and file/pipe protocols, no input-controlled network fetch. Progress callback 0..99, no output ready until all artifacts validated. French-safe errors, bounded logs, timeouts.

## Backend shared DTO

`VideoJobStatus = 'uploading'|'queued'|'processing'|'ready'|'failed'|'cancelled'`.
`VideoJobInfo = {id:string;lessonId:string;status:VideoJobStatus;progress:number;filename:string;error?:string;videoUrl?:string;posterUrl?:string;durationSeconds?:number}`. No signed download/source key exposure in get DTO.
`MAX_PHONE_VIDEO_BYTES`, `MAX_PHONE_VIDEO_SECONDS`, `PHONE_VIDEO_ACCEPT`, `getPhoneVideoContentType(filename:string,reportedType?:string): string|null` in shared/phoneVideo.ts (extension inference for blank iOS MIME; normalize M4V to MP4 type).
Shared Lesson gains optional `videoJobId?:string`, `videoPosterUrl?:string`, `videoPending?:boolean`. Admin serializations expose current job ID; public catalog does not expose source keys/errors and may expose only videoPending + output poster.

## tRPC video router (registered by parent as video)

All procedures adminProcedure, preserve actual OAuth permissions.
- `prepare` mutation `{lessonId, revision, filename, contentType, size}` -> `{jobId, uploadUrl, contentType, lessonRevision}`. Validate source extension/type/size, active lesson + expected revision, create owned pending source upload and job. Bind job to lesson; bump revision safely. Preserve old video URL until ready. Reject a simultaneous active source upload unless explicit cancellation/replacement handles it safely.
- `finish` mutation `{id}` -> VideoJobInfo. Owned job only; HEAD-check actual object size/type; transition uploading->queued idempotently; kick worker. Never return raw source URL as lesson-ready. Source contentUploads may use expanded status 'source' to distinguish verified originals from ready playable outputs, or remain pending with job indicating verification; guard generic video finish.
- `get` query `{id}` -> VideoJobInfo; ownership checked; kick worker for recovery. No source URL.
- `retry` mutation `{id}` -> VideoJobInfo; owned failed job only, using retained verified source; stale/current lesson checks.
- `cancel` mutation `{id}` -> VideoJobInfo; owned unfinished job only; clear active pointer only if it matches job, preserve old video; signal/fence worker. No promise of deleting objects.

## Durable worker

`startVideoWorker():void`, `kickVideoWorker():void`, optional `stopVideoWorker():Promise<void>` exports. Start after initial content readiness; no database writes in module import. Single active conversion per process, periodic durable recovery, global lease token guards a given job, pipelineVersion=1, bounded retry/reclaim attempts, lease heartbeats and cancellation abort. Resume by rerunning conversion from retained source after crash. Store output video and poster as new ready contentUploads owned by job owner so existing owned-file validators accept them. Transactionally attach output URL, poster and formatted duration to a still-active lesson only when its active job pointer and fenced lease match. Increase revision; never overwrite unrelated lesson text/resources, a newer upload or an archived lesson/course. Old playable video is retained on queued/failure/cancel. Cleanup temporary files in all paths. Logs must not include signed URLs or secrets.

## UI

Mobile French file/gallery button plus camera input (`capture=environment`), progress+cancel during direct PUT, file accept and MIME inference, notify backend finish then show durable conversion progress through get polling. Poll active jobs only; recover current lesson job ID after reload. Network upload interruption is retry-from-file, not chunk resumability. Failed conversion offers retry/cancel/choose another file. No raw source URL assigned to lesson form. Disable/reconcile edits while active; require dirty/new lessons saved first to avoid revision clobber. Conversion completion invalidates adminGet/catalog and refreshes stored lesson video URL/poster/duration. Preserve existing Vimeo/embed link mode and document/image upload handlers. Status and limits visible, accessible 44px touch controls, original visual styling.

## Publication boundary

Real conversion in current Preview; add FFmpeg to Dockerfile. Production resource contract can prepare 1cpu/2048MiB but no publish. Always-on worker hosting requires owner platform approval before launch; do not enable paid hosting or manufacture keep-alive traffic. No migration application or DB test writes by agents.
