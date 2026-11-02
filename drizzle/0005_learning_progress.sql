CREATE TABLE `clientLessonProgress` (
	`clientId` varchar(64) NOT NULL,
	`lessonId` varchar(128) NOT NULL,
	`completed` boolean NOT NULL DEFAULT false,
	`completedSetAt` datetime(3),
	`saved` boolean NOT NULL DEFAULT false,
	`savedSetAt` datetime(3),
	`note` text NOT NULL,
	`noteRevision` int NOT NULL DEFAULT 0,
	`lastViewedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	`updatedAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
	CONSTRAINT `clientLessonProgress_clientId_lessonId_pk` PRIMARY KEY(`clientId`,`lessonId`)
);
--> statement-breakpoint
ALTER TABLE `clientLessonProgress` ADD CONSTRAINT `clientLessonProgress_clientId_coachingClients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `coachingClients`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `clientLessonProgress` ADD CONSTRAINT `clientLessonProgress_lessonId_contentLessons_id_fk` FOREIGN KEY (`lessonId`) REFERENCES `contentLessons`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `clientLessonProgress_client_lastViewed_idx` ON `clientLessonProgress` (`clientId`,`lastViewedAt`);
