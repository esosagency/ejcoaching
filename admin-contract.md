# Contrat d’intégration de l’administration

Les types `Course`, `Lesson`, `CourseInput`, `LessonInput`, `LessonResource` sont définis dans `shared/content.ts`. Les procédures tRPC sont sous `content`. Les IDs sont des chaînes, inchangées pour les cours d’exemple.

- `catalog` : query publique sans input -> `Course[]`, seulement les cours publiés et leçons non archivées.
- `adminList` : query administrateur sans input -> `Course[]`, cours publiés et brouillons non archivés, avec leçons.
- `adminGet` : query administrateur `{id:string}` -> `Course`, erreur NOT_FOUND si absent.
- `createCourse` : mutation admin `CourseInput` -> `{id:string}`; position ajoutée à la fin, ID créé côté serveur.
- `updateCourse` : mutation admin `{id:string,revision:number,data:CourseInput}` -> `{id:string}`; conflit si version dépassée.
- `archiveCourse` : mutation admin `{id:string,revision:number}` -> `{ok:true}`; archivage seulement.
- `createLesson` : mutation admin `{courseId:string,data:LessonInput}` -> `{id:string}`; ID créé côté serveur, position à la fin.
- `updateLesson` : mutation admin `{courseId:string,id:string,revision:number,data:LessonInput}` -> `{id:string}`.
- `archiveLesson` : mutation admin `{courseId:string,id:string,revision:number}` -> `{ok:true}`.
- `reorderLessons` : mutation admin `{courseId:string,ids:string[]}` -> `{ok:true}`; validation d’une permutation complète et opération transactionnelle.
- `prepareUpload` : mutation admin `{filename:string,contentType:string,size:number,kind:'video'|'image'|'document'}` -> `{id:string,uploadUrl:string}`; lien de téléversement signé envoyé uniquement à l’administrateur.
- `finishUpload` : mutation admin `{id:string}` -> `{url:string,id:string,filename:string}`; validation effective de l’objet par taille/type avant de fournir sa référence stable. Limites : MP4 250 Mio, PDF 25 Mio, JPG/PNG/WebP 10 Mio. Les clés sont aléatoires et ASCII; les credentials ne sont jamais envoyés au navigateur.

`server/db.ts` reste sous responsabilité du parent pour l’attribution du rôle à partir de `adminAccess` (colonne `email`, varchar320 clé primaire, adresse normalisée). Le backend gère le schéma `adminAccess`, les tables de contenu, le routeur `contentRouter`, et les scripts `scripts/seed-content.ts` / `scripts/set-admin.ts`. Le second script reçoit le courriel en argument, inscrit l’autorisation explicitement et peut mettre à jour le rôle d’un utilisateur déjà identifié par OAuth. Il ne crée jamais un utilisateur fictif. La préparation n’est pas exécutée automatiquement sur chaque démarrage.

Le parent branche `contentRouter` dans `server/routers.ts`, adapte le catalogue client et l’authentification. Le frontend admin utilise les hooks typés `trpc.content.*`, conserve tous les textes en français québécois et invalide les lectures après mutation. L’aperçu côté client d’un brouillon utilise une query admin explicite, jamais une lecture publique de brouillon. Si une fonction d’aperçu de brouillon n’est pas livrée, le bouton doit l’expliquer et ne pas donner une route publique inexistante.
