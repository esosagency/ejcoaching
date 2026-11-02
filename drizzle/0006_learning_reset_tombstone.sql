CREATE TABLE `clientLearningState` (
	`clientId` varchar(64) NOT NULL,
	`lastResetAt` datetime(3) NOT NULL,
	CONSTRAINT `clientLearningState_clientId` PRIMARY KEY(`clientId`)
);
--> statement-breakpoint
ALTER TABLE `clientLearningState` ADD CONSTRAINT `clientLearningState_clientId_coachingClients_id_fk` FOREIGN KEY (`clientId`) REFERENCES `coachingClients`(`id`) ON DELETE restrict ON UPDATE cascade;