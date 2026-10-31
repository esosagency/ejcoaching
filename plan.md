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
