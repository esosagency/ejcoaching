CREATE TABLE `adminAccess` (
	`email` varchar(320) NOT NULL,
	`createdAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `adminAccess_email` PRIMARY KEY(`email`)
);
--> statement-breakpoint
CREATE TABLE `contentCourses` (
	`id` varchar(128) NOT NULL,
	`title` varchar(180) NOT NULL,
	`category` varchar(100) NOT NULL,
	`eyebrow` varchar(160) NOT NULL,
	`description` text NOT NULL,
	`color` varchar(16) NOT NULL,
	`image` varchar(2048),
	`icon` enum('nutrition','training','mindset','deficit','surplus','equipment','supplements') NOT NULL,
	`status` enum('draft','published') NOT NULL DEFAULT 'draft',
	`isSample` boolean NOT NULL DEFAULT false,
	`position` int NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`archivedAt` datetime,
	`createdAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `contentCourses_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contentLessons` (
	`id` varchar(128) NOT NULL,
	`courseId` varchar(128) NOT NULL,
	`title` varchar(180) NOT NULL,
	`duration` varchar(32) NOT NULL,
	`description` text NOT NULL,
	`takeaways` json NOT NULL,
	`videoUrl` varchar(2048),
	`videoType` enum('demo','file','embed') NOT NULL DEFAULT 'demo',
	`resources` json NOT NULL,
	`position` int NOT NULL,
	`revision` int NOT NULL DEFAULT 1,
	`archivedAt` datetime,
	`createdAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `contentLessons_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `contentSetup` (
	`marker` varchar(128) NOT NULL,
	`completedAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	CONSTRAINT `contentSetup_marker` PRIMARY KEY(`marker`)
);
--> statement-breakpoint
CREATE TABLE `contentUploads` (
	`id` varchar(64) NOT NULL,
	`ownerUserId` int NOT NULL,
	`objectKey` varchar(512) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`contentType` varchar(128) NOT NULL,
	`size` int NOT NULL,
	`kind` enum('video','image','document') NOT NULL,
	`status` enum('pending','ready') NOT NULL DEFAULT 'pending',
	`createdAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`readyAt` datetime,
	CONSTRAINT `contentUploads_id` PRIMARY KEY(`id`),
	CONSTRAINT `contentUploads_objectKey_unique` UNIQUE(`objectKey`)
);
--> statement-breakpoint
ALTER TABLE `contentLessons` ADD CONSTRAINT `contentLessons_courseId_contentCourses_id_fk` FOREIGN KEY (`courseId`) REFERENCES `contentCourses`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `contentUploads` ADD CONSTRAINT `contentUploads_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `contentCourses_catalog_idx` ON `contentCourses` (`archivedAt`,`status`,`position`);--> statement-breakpoint
CREATE INDEX `contentLessons_course_order_idx` ON `contentLessons` (`courseId`,`archivedAt`,`position`);--> statement-breakpoint
CREATE INDEX `contentUploads_owner_status_idx` ON `contentUploads` (`ownerUserId`,`status`);