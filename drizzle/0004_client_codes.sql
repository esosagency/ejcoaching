CREATE TABLE `clientCodeAttempts` (
	`scopeHash` varchar(64) NOT NULL,
	`windowStartedAt` datetime NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`blockedUntil` datetime,
	`updatedAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `clientCodeAttempts_scopeHash` PRIMARY KEY(`scopeHash`)
);
--> statement-breakpoint
CREATE TABLE `clientCodeSessions` (
	`tokenHash` varchar(64) NOT NULL,
	`clientId` varchar(64) NOT NULL,
	`codeVersion` int NOT NULL,
	`expiresAt` datetime NOT NULL,
	`revokedAt` datetime,
	`createdAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `clientCodeSessions_tokenHash` PRIMARY KEY(`tokenHash`)
);
--> statement-breakpoint
ALTER TABLE `coachingClients` DROP INDEX `coachingClients_email_unique`;--> statement-breakpoint
ALTER TABLE `coachingClients` MODIFY COLUMN `email` varchar(320);--> statement-breakpoint
ALTER TABLE `coachingClients` ADD `codeLookupHash` varchar(64);--> statement-breakpoint
ALTER TABLE `coachingClients` ADD `codeVerifier` varchar(512);--> statement-breakpoint
ALTER TABLE `coachingClients` ADD `codeVersion` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `coachingClients` ADD `codeIssuedAt` datetime;--> statement-breakpoint
ALTER TABLE `coachingClients` ADD `lastCodeLoginAt` datetime;--> statement-breakpoint
ALTER TABLE `coachingClients` ADD CONSTRAINT `coachingClients_codeLookupHash_unique` UNIQUE(`codeLookupHash`);--> statement-breakpoint
ALTER TABLE `clientCodeSessions` ADD CONSTRAINT `clientCodeSessions_clientId_coachingClients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `coachingClients`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `clientCodeSessions_client_active_idx` ON `clientCodeSessions` (`clientId`,`revokedAt`,`expiresAt`);