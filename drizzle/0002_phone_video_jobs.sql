CREATE TABLE `contentVideoJobs` (
	`id` varchar(64) NOT NULL,
	`lessonId` varchar(128) NOT NULL,
	`ownerUserId` int NOT NULL,
	`sourceUploadId` varchar(64) NOT NULL,
	`status` enum('uploading','queued','processing','ready','failed','cancelled') NOT NULL DEFAULT 'uploading',
	`progress` int NOT NULL DEFAULT 0,
	`filename` varchar(255) NOT NULL,
	`pipelineVersion` int NOT NULL DEFAULT 1,
	`attempts` int NOT NULL DEFAULT 0,
	`leaseToken` varchar(64),
	`leaseExpiresAt` datetime,
	`lastHeartbeatAt` datetime,
	`outputVideoUploadId` varchar(64),
	`posterUploadId` varchar(64),
	`durationSeconds` int,
	`error` varchar(1000),
	`createdAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`updatedAt` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP),
	`finishedAt` datetime,
	CONSTRAINT `contentVideoJobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `contentVideoJobs_sourceUploadId_unique` UNIQUE(`sourceUploadId`)
);
--> statement-breakpoint
ALTER TABLE `contentUploads` MODIFY COLUMN `status` enum('pending','source','ready') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `contentLessons` ADD `videoJobId` varchar(64);--> statement-breakpoint
ALTER TABLE `contentLessons` ADD `videoPosterUrl` varchar(2048);--> statement-breakpoint
ALTER TABLE `contentVideoJobs` ADD CONSTRAINT `contentVideoJobs_lessonId_contentLessons_id_fk` FOREIGN KEY (`lessonId`) REFERENCES `contentLessons`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `contentVideoJobs` ADD CONSTRAINT `contentVideoJobs_ownerUserId_users_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `users`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `contentVideoJobs` ADD CONSTRAINT `contentVideoJobs_sourceUploadId_contentUploads_id_fk` FOREIGN KEY (`sourceUploadId`) REFERENCES `contentUploads`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `contentVideoJobs` ADD CONSTRAINT `contentVideoJobs_outputVideoUploadId_contentUploads_id_fk` FOREIGN KEY (`outputVideoUploadId`) REFERENCES `contentUploads`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE `contentVideoJobs` ADD CONSTRAINT `contentVideoJobs_posterUploadId_contentUploads_id_fk` FOREIGN KEY (`posterUploadId`) REFERENCES `contentUploads`(`id`) ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX `contentVideoJobs_queue_idx` ON `contentVideoJobs` (`status`,`leaseExpiresAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `contentVideoJobs_lesson_idx` ON `contentVideoJobs` (`lessonId`,`status`);--> statement-breakpoint
CREATE INDEX `contentVideoJobs_owner_idx` ON `contentVideoJobs` (`ownerUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `contentLessons_video_job_idx` ON `contentLessons` (`videoJobId`);