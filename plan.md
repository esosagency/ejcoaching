# EJ Coaching — gestion du contenu

La demande actuelle autorise l’ajout de la base de données et d’un espace administrateur à la plateforme existante. Le design français québécois est conservé. Le prototype devient une application React/Express/tRPC avec MySQL géré; le serveur existant dessert l’interface et les API sur le même port.

## Fonctionnement

Les cours, les leçons, leur ordre, les vidéos et les documents associés deviennent des enregistrements persistants. Les cours d’exemple français sont importés une seule fois avec un marqueur de préparation; un redémarrage ne réécrit jamais des modifications de l’administrateur. La bibliothèque des clients lit les cours publiés dans la base et masque les brouillons. La progression locale actuelle reste inchangée; la gestion des inscriptions et les suivis clients ne sont pas ajoutés à cette demande.

L’administration utilise la connexion Manus existante et des procédures serveur réservées au rôle administrateur. Le rôle est accordé uniquement à l’adresse de compte explicitement fournie par le propriétaire, vérifiée via l’identité OAuth actuelle à chaque authentification; aucune permission n’est accordée au premier visiteur ou à un utilisateur fictif. La table d’autorisation est l’unique source du rôle, et un rôle fourni à l’utilitaire de synchronisation est ignoré. Un échec de vérification d’identité refuse l’accès. Les utilisateurs non connectés voient une invitation à se connecter, les autres comptes un état d’accès refusé.

L’administrateur peut créer des cours, modifier titres/descriptions/catégories/couvertures, choisir brouillon ou publié, créer et modifier des leçons, ajouter une URL vidéo ou téléverser un MP4, joindre des documents, et réorganiser les leçons. Les suppressions de contenus sont des archivages avec confirmation explicite dans l’interface; aucun effacement physique de fichiers n’est promis. L’ordre est validé côté serveur et enregistré transactionnellement. Les fichiers de cours sont transférés vers le stockage durable, jamais enregistrés dans le système de fichiers du serveur. Les types et tailles sont contrôlés, et seuls les administrateurs peuvent obtenir des téléversements.

## Structure

- `drizzle/` : tables, contraintes et migrations additives des utilisateurs, cours, leçons, documents, accès administrateur et préparation initiale.
- `server/db.ts`, `server/contentDb.ts` et `server/contentRouter.ts` : lectures publiques des cours publiés, mutations administrateur et stockage des métadonnées.
- `server/_core/` : sessions, permissions, cookies et serveur Express existants, préservés.
- `scripts/` : préparation idempotente du contenu de départ et configuration ciblée du compte autorisé; les connexions temporaires sont fermées.
- `client/src/contexts/CatalogContext.tsx` : catalogue issu de l’API, états de chargement et d’erreur sans faux remplacement par les données locales.
- `client/src/pages/admin/` : liste des cours, éditeur de cours/leçons et gestion des fichiers dans le style EJ Coaching.
- Pages clients existantes : lectures du catalogue partagé et affichage du média sélectionné sans altérer les liens ni les progrès locaux.

Les nouveaux fichiers utilisent les diagnostics TypeScript du projet. Le serveur passe de `dev:static` à `dev`; le déploiement utilise le Dockerfile existant et `/api/health`. Les autorisations et la persistance sont vérifiées sans créer de faux utilisateurs administrateurs ni modifier les données clients pendant les tests.

## Vimeo hosting and privacy

The creator selected Vimeo hosting. The lesson player, editor and server share validated Vimeo URL handling, including unlisted video privacy hashes, so approved private embed links remain intact. Vimeo access uses the creator’s actual account; no credentials or fabricated videos are introduced. The site remains unpublished unless the creator separately authorizes publication. While unpublished, only the exact current Preview hostname may be authorized for testing; the final website hostname is added once known and approved. Vimeo domain privacy is configured on the selected EJ Coaching videos or dedicated upload defaults, not unrelated videos. Domain restrictions do not replace client login and course permissions, which remain a separate unfinished feature.

### Current Vimeo account outcome

The creator connected a new Free Vimeo account. The actual account UI gates both account-wide domain defaults and per-video Specific domains behind Upgrade, despite generic documentation describing broader availability. No subscription was purchased. As a safe staging setting, only future-upload visibility was saved as Private; it must later become an appropriate client-playable privacy mode, not remain Private for client course playback. The existing 12-second EJ Coaching technical demo is privately hosted on Vimeo (video 1241612447) for the subsequent domain test. No customer course record was changed. Domain configuration and playback verification are explicitly pending the creator’s choice on a compatible Vimeo subscription and the exact final domain. Direct MP4 delivery remains available as an alternative.

## Direct phone upload and automatic conversion

The creator uses an iPhone 17 Pro Max and approved implementing the native phone-to-EJ Coaching workflow. Preserve the existing French Canadian interface and premium reference-inspired lesson layout; no Vimeo/Wistia account is required for this path.

### Workflow and structure

- An authenticated administrator selects an existing, saved lesson, selects a recording from Photos/files or uses a native camera file picker, and transfers the source directly to managed storage with progress and cancellation. Unsaved lesson changes must be saved before starting so asynchronous video updates cannot overwrite text edits. New lessons are saved first.
- `shared/phoneVideo.ts` owns source format inference, limits and the job DTO. `server/video/` owns streaming storage transfer, FFprobe/FFmpeg conversion, durable MySQL job operations, the protected video router and a single-concurrency queue consumer. `client/src/components/admin/PhoneVideoUpload.tsx` owns the mobile uploader and persisted processing status. Existing admin forms embed that component; existing lesson players use the generated poster and compatible MP4.
- Separate video routes prepare a source upload bound to a lesson/revision, verify its actual stored size and type, then enqueue conversion. General image/document routes remain compatible; general video finalization must not expose unconverted recordings as ready lesson files.
- Persist every job and its source ownership, status, progress, attempts, pipeline version, worker lease/token, outputs and errors. Lease fencing prevents duplicate/stale workers from attaching an output. Recover interrupted work after restart; cancellation, retry and replacement must not overwrite a newer upload. Existing lesson videos remain playable until a successful new conversion is attached. Archiving a lesson prevents later attachment.
- FFmpeg handles MOV/HEVC/MP4/M4V/WebM/3GP, portrait rotation and common HDR-to-SDR tone mapping. Produce browser-compatible H.264/AAC MP4 with fast-start metadata, up to 1080p landscape or 1080x1920 portrait, at most 30 fps, plus a JPEG poster. Preserve speech audio and aspect ratio. Reject corrupt/audio-only/unsupported inputs with useful French errors rather than reporting success.
- Source limits for this first version: 1 GiB per recording, 30 minutes, up to 4K-class input. Converted outputs are bounded at 1 GiB. These limits are visible in the uploader. No adaptive-bitrate HLS, chunk-resumable upload or ProRes RAW support is promised. Network interruption before source transfer finishes requires retrying the upload; after confirmation, processing is server-side.
- Stream source and output bytes, never buffer whole videos. Use temporary per-job files only during conversion and clean them in finally blocks. Durable media stays in object storage, not Git or container disk.

### Serving and production boundary

Continue using the existing Express/tRPC/React application and managed MySQL/storage. Include FFmpeg in the Dockerfile. Use a database-backed queue with periodic recovery and one local consumer; timers are not the durable job record. Worker starts after content readiness and uses leases so restarts and overlapping containers are safe. Prepare 1 vCPU / 2048 MiB for a subsequent publish using the current Webdev resource contract. A resident worker is required for reliable conversion while no client request is open; production always-on hosting requires the platform-owned approval flow before launch. Do not activate paid hosting, change its residency policy, purchase any external service or publish in this implementation step. Preview runs the real processing pipeline in the existing development service. Client enrollment/entitlements remain the already-disclosed separate launch requirement.

### Verified production encoder compatibility

The processor requires the FFmpeg 6+ `-display_rotation` input option to remove the old display matrix before baking orientation into the output. Sandbox has FFmpeg 6.1.1. The production Dockerfile now uses the official `node:22-trixie-slim` image (tag verified at https://github.com/docker-library/official-images/blob/master/library/node) because Debian Trixie ships FFmpeg 7.1.x (verified at https://packages.debian.org/trixie/ffmpeg); Bookworm’s older FFmpeg is not adequate. Build capability checks require display_rotation and zscale. This is a prepared image, not a claimed successful hosted build.

Stable `/manus-storage/<key>` media paths are intentionally resolved by the Manus Preview/published gateway, as specified in the current Webdev storage contract. Direct development-port responses are not evidence of gateway media failure. Do not register a redundant legacy application storage proxy or substitute signed temporary URLs into stored lesson data. Source originals remain excluded from job/catalog DTOs; client access controls remain a separate launch feature.

Production capacity adjustment: stage the exact 2 vCPU / 4096 MiB tier for the next publish instead of 1/2048. A 1 GiB source and a potentially 1 GiB output must coexist temporarily with decoder/encoder memory and the web server; the smaller tier leaves inadequate worst-case headroom, particularly on memory-backed temporary filesystems. Conversion remains one job at a time. This declaration does not change Preview capacity, activate residency, purchase hosting or publish; actual deployed capacity and owner-approved residency must be verified at launch.
