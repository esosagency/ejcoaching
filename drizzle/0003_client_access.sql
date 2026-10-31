CREATE TABLE `clientCourseAccess` (
	`clientId` varchar(64) NOT NULL,
	`courseId` varchar(128) NOT NULL,
	`createdAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `clientCourseAccess_clientId_courseId_pk` PRIMARY KEY(`clientId`,`courseId`)
);
--> statement-breakpoint
CREATE TABLE `coachingClients` (
	`id` varchar(64) NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(180) NOT NULL,
	`status` enum('active','revoked') NOT NULL DEFAULT 'active',
	`revision` int NOT NULL DEFAULT 1,
	`createdBy` int NOT NULL,
	`createdAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `coachingClients_id` PRIMARY KEY(`id`),
	CONSTRAINT `coachingClients_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `privateMedia` (
	`objectKey` varchar(512) NOT NULL,
	`id` varchar(64) NOT NULL,
	`keyBase64` varchar(44) NOT NULL,
	`nonceBase64` varchar(16) NOT NULL,
	`plainSize` int NOT NULL,
	`chunkSize` int NOT NULL,
	`contentType` varchar(128) NOT NULL,
	`layout` enum('single','parts') NOT NULL,
	`status` enum('pending','ready') NOT NULL DEFAULT 'pending',
	`createdAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `privateMedia_objectKey` PRIMARY KEY(`objectKey`),
	CONSTRAINT `privateMedia_id_unique` UNIQUE(`id`)
);
--> statement-breakpoint
ALTER TABLE `clientCourseAccess` ADD CONSTRAINT `clientCourseAccess_clientId_coachingClients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `coachingClients`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `clientCourseAccess` ADD CONSTRAINT `clientCourseAccess_courseId_contentCourses_id_fk` FOREIGN KEY (`courseId`) REFERENCES `contentCourses`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `coachingClients` ADD CONSTRAINT `coachingClients_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `clientCourseAccess_course_idx` ON `clientCourseAccess` (`courseId`);--> statement-breakpoint
CREATE INDEX `coachingClients_status_idx` ON `coachingClients` (`status`);--> statement-breakpoint
CREATE INDEX `privateMedia_status_idx` ON `privateMedia` (`status`,`updatedAt`);